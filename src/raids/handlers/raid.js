import {
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { truncate } from '../../lib/text.js';
import { addDaysToDate, localDate, localTimeToSeconds } from '../../lib/time.js';
import { deferPrivate, sendPrivate } from '../../loot/discord/privateReply.js';
import { RaidHelperError } from '../apiClient.js';
import { formatDate, parseDateInput, parseTimeInput, todayIn } from '../dates.js';
import { raidersOf, sortRaiders } from '../missing.js';
import { expandLineBreaks, postConfiguredEvent } from '../posting.js';
import { reportEmbed } from '../report.js';
import { eventUrl, isConfiguredEvent, rosterRoleId } from '../schedule.js';

export const DATE_HELP = 'Use a date such as 2026-11-04, Nov 4 or 11/4.';
export const RAID_HELPER_ERROR_MESSAGE =
  'Raid-Helper returned an error, so nothing was done. Check the bot logs.';

// How long the /raid create form waits to be submitted.
export const FORM_TIMEOUT_MS = 15 * 60 * 1000;
// Discord's modal title limit, in characters.
const FORM_TITLE_LIMIT = 45;
const TIME_HELP = 'Use a 24-hour time such as 19:30.';

export const NO_EVENTS_MESSAGE =
  'No raid events are set up yet. An Officer can add one with `/raidsetup event add`.';

// /raid create: checks the raid and date, then opens a form with the time, title and description,
// filled in from the options or the event's setup, and posts the event through Raid-Helper on
// submit.
export async function createRaid(interaction, context) {
  const { setup, timeZone } = context;
  const now = Date.now();
  if (setup.events.length === 0) {
    await sendPrivate(interaction, { content: NO_EVENTS_MESSAGE });
    return;
  }

  const name = interaction.options.getString('raid', true).trim();
  const eventConfig = setup.events.find((event) => event.name.toLowerCase() === name.toLowerCase());
  if (!eventConfig) {
    await sendPrivate(interaction, {
      content: `There is no event named "${escapeMarkdown(name)}". Choose one from the list.`,
    });
    return;
  }

  const dateText = interaction.options.getString('date', true);
  const date = parseDateInput(dateText, timeZone, now);
  if (!date) {
    await sendPrivate(interaction, {
      content: `"${escapeMarkdown(dateText.trim())}" is not a date. ${DATE_HELP}`,
    });
    return;
  }
  if (date < todayIn(timeZone, now)) {
    await sendPrivate(interaction, { content: `${formatDate(date)} has already passed.` });
    return;
  }

  const timeOption = interaction.options.getString('time');
  if (timeOption !== null && !parseTimeInput(timeOption)) {
    await sendPrivate(interaction, {
      content: `"${escapeMarkdown(timeOption.trim())}" is not a time. ${TIME_HELP}`,
    });
    return;
  }

  const formId = `raid-create:${interaction.id}`;
  await interaction.showModal(
    createForm(formId, {
      heading: `${eventConfig.name} · ${formatDate(date)}`,
      time: timeOption?.trim() ?? eventConfig.weekly?.time,
      title:
        interaction.options.getString('title')?.trim() || eventConfig.title || eventConfig.name,
      description: expandLineBreaks(
        interaction.options.getString('description')?.trim() || eventConfig.description || '',
      ),
    }),
  );

  let submit;
  try {
    submit = await interaction.awaitModalSubmit({
      filter: (candidate) =>
        candidate.customId === formId && candidate.user.id === interaction.user.id,
      time: FORM_TIMEOUT_MS,
    });
  } catch {
    // Closed or left open past the time limit; nothing to answer.
    return;
  }
  await postFromForm(submit, context, { eventConfig, date });
}

function createForm(formId, { heading, time, title, description }) {
  const input = (id, style) => new TextInputBuilder().setCustomId(id).setStyle(style);
  const timeInput = input('time', TextInputStyle.Short)
    .setMinLength(4)
    .setMaxLength(5)
    .setPlaceholder('19:30');
  if (time) timeInput.setValue(time);
  const descriptionInput = input('description', TextInputStyle.Paragraph)
    .setMaxLength(1000)
    .setRequired(false);
  if (description) descriptionInput.setValue(description);

  return new ModalBuilder()
    .setCustomId(formId)
    .setTitle(truncate(heading, FORM_TITLE_LIMIT))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Start time')
        .setDescription('24-hour time, e.g. 19:30')
        .setTextInputComponent(timeInput),
      new LabelBuilder()
        .setLabel('Title')
        .setTextInputComponent(
          input('title', TextInputStyle.Short).setMaxLength(100).setValue(title),
        ),
      new LabelBuilder()
        .setLabel('Description')
        .setDescription('Optional')
        .setTextInputComponent(descriptionInput),
    );
}

// Posts the event from a submitted /raid create form. Replies go to the form submission.
async function postFromForm(interaction, context, { eventConfig, date }) {
  const { guild, member, store, api, scheduler, apiKey, timeZone } = context;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const timeText = interaction.fields.getTextInputValue('time');
  // A blank title falls back to the config one.
  const title = interaction.fields.getTextInputValue('title').trim() || undefined;
  const description = interaction.fields.getTextInputValue('description').trim() || undefined;

  const refuse = (content) =>
    sendPrivate(interaction, { content, embeds: [typedForm(title, description)] });
  const time = parseTimeInput(timeText);
  if (!time) {
    await refuse(
      `"${escapeMarkdown(timeText.trim())}" is not a time. ${TIME_HELP} Nothing was posted; ` +
        'run `/raid create` again. What you typed:',
    );
    return;
  }
  const startTime = localTimeToSeconds(date, time, timeZone);
  if (startTime <= nowSeconds) {
    await refuse(`<t:${startTime}:F> has already passed, so nothing was posted. What you typed:`);
    return;
  }

  // Listing and posting can take longer than Discord's 3-second reply deadline.
  await deferPrivate(interaction);
  const logInfo = { guildId: guild.id, eventName: eventConfig.name, date, userId: member.id };
  let result;
  try {
    const existingEvents = await api.listEvents(guild.id, apiKey, {
      startTime: localTimeToSeconds(date, '00:00', timeZone),
      endTime: localTimeToSeconds(addDaysToDate(date, 1), '00:00', timeZone) - 1,
    });
    result = await postConfiguredEvent({
      api,
      store,
      guildId: guild.id,
      apiKey,
      eventConfig,
      startTime,
      timeZone,
      existingEvents,
      postedBy: member.id,
      title,
      description,
      now: nowSeconds,
    });
  } catch (error) {
    if (!(error instanceof RaidHelperError)) throw error;
    logger.error({ ...logInfo, err: error }, 'Failed to post a Raid-Helper event');
    await sendPrivate(interaction, { content: RAID_HELPER_ERROR_MESSAGE });
    return;
  }

  const { event, created } = result;
  scheduler?.addUpcomingEvent(guild.id, event);
  const url = eventUrl(guild.id, event);
  if (created) {
    logger.info({ ...logInfo, eventId: event.id }, 'Posted a Raid-Helper event');
    await sendPrivate(interaction, {
      content: `Posted **${escapeMarkdown(event.title)}** for <t:${event.startTime}:F>: ${url}`,
    });
  } else {
    await sendPrivate(interaction, {
      content:
        `There is already an event titled **${escapeMarkdown(event.title)}** in ` +
        `<#${event.channelId}> on that date, so nothing was posted: ${url}`,
    });
  }
}

// The title and description from a refused form, so they can be copied into the next one.
// Escaping can push a full description past Discord's 1024-character field limit.
function typedForm(title, description) {
  const field = (text) => (text ? truncate(escapeMarkdown(text), 1024) : '(none)');
  return new EmbedBuilder()
    .setTitle('Your form')
    .addFields(
      { name: 'Title', value: field(title) },
      { name: 'Description', value: field(description) },
    );
}

// /raid missing: who has not signed up for an event, right now.
export async function missingForEvent(interaction, context) {
  const { guild, store, api, timeZone } = context;
  const eventId = interaction.options.getString('event', true).trim();
  if (!/^\d{1,20}$/.test(eventId)) {
    await sendPrivate(interaction, { content: 'Choose an event from the list.' });
    return;
  }

  await deferPrivate(interaction);
  let event;
  try {
    event = await api.getEvent(eventId);
  } catch (error) {
    if (!(error instanceof RaidHelperError)) throw error;
    logger.error({ guildId: guild.id, eventId, err: error }, 'Failed to fetch a Raid-Helper event');
    await sendPrivate(interaction, { content: RAID_HELPER_ERROR_MESSAGE });
    return;
  }

  if (!event || !isConfiguredEvent(event, context.setup, guild.id)) {
    await sendPrivate(interaction, {
      content: "There is no such event in this server's raid channels. Choose one from the list.",
    });
    return;
  }

  const roleId = rosterRoleId(context.setup, event.channelId);
  const raiders = raidersOf(guild, roleId);
  const sorted = sortRaiders(
    raiders,
    event,
    store.absentUserIds(guild.id, localDate(event.startTime, timeZone)),
  );
  const embed = reportEmbed({
    guild,
    event,
    roleId,
    rosterSize: raiders.length,
    sorted,
    reason: 'Checked',
    checkedAt: Date.now(),
  });
  await sendPrivate(interaction, { embeds: [embed] });
}
