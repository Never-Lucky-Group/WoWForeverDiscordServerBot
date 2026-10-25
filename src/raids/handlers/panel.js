import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Colors,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  escapeMarkdown,
} from 'discord.js';
import { WEEKDAYS } from '../../config.js';
import { COMMAND_ERROR_MESSAGE, NO_PERMISSION_MESSAGE } from '../../handlers/commandInteraction.js';
import { logger } from '../../lib/logger.js';
import { isOfficer } from '../../lib/membership.js';
import { respond } from '../../lib/respond.js';
import { truncate } from '../../lib/text.js';
import { NO_MENTIONS, sendPrivate } from '../../loot/discord/privateReply.js';
import { DEFAULT_RAID_RESET } from '../../loot/raidWeeks.js';
import { raidsContext } from '../commandContext.js';
import { parseTimeInput } from '../dates.js';
import { TITLE_HELP, titleProblem } from '../titles.js';
import { expandLineBreaks } from '../posting.js';
import {
  DEFAULT_POST_AFTER_HOURS,
  MAX_EVENTS,
  POST_AFTER_HOURS,
  loadSetup,
  postAfterText,
} from '../setup.js';
import {
  LEADER_BOT_MESSAGE,
  canonicalTimeZone,
  deleteEvent,
  eventSummary,
  newEventProblem,
  parseReminderHours,
  saveEventChange,
  saveNewEvent,
  saveSettings,
} from './setup.js';

// /raidsetup panel: a private message with the raid setup and buttons that open short forms, for
// Officers who would rather not type slash command options. It changes the setup through the
// same functions as the /raidsetup subcommands.

// How long the panel keeps working after it last answered a click or form. Discord lets the bot
// change a private message only for 15 minutes after the interaction that last answered it, so
// the panel closes a little earlier, while it can still take its buttons away.
export const PANEL_IDLE_MS = 14 * 60_000;
// Raid-Helper posts in text and announcement channels.
export const RAID_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
// The time zones the Settings form offers, US first. Any other can be set with
// /raidsetup settings set, and is then offered too.
export const COMMON_TIME_ZONES = [
  { zone: 'America/New_York', label: 'US Eastern' },
  { zone: 'America/Chicago', label: 'US Central' },
  { zone: 'America/Denver', label: 'US Mountain' },
  { zone: 'America/Phoenix', label: 'US Arizona (no daylight saving)' },
  { zone: 'America/Los_Angeles', label: 'US Pacific' },
  { zone: 'America/Anchorage', label: 'US Alaska' },
  { zone: 'Pacific/Honolulu', label: 'US Hawaii' },
  { zone: 'America/Halifax', label: 'Canada Atlantic' },
  { zone: 'UTC', label: 'UTC' },
  { zone: 'Europe/London', label: 'UK and Ireland' },
  { zone: 'Europe/Berlin', label: 'Central Europe' },
  { zone: 'Europe/Helsinki', label: 'Eastern Europe' },
  { zone: 'America/Sao_Paulo', label: 'Brazil' },
  { zone: 'Asia/Singapore', label: 'Singapore' },
  { zone: 'Asia/Tokyo', label: 'Japan and Korea' },
  { zone: 'Australia/Perth', label: 'Australia Western' },
  { zone: 'Australia/Adelaide', label: 'Australia Central' },
  { zone: 'Australia/Brisbane', label: 'Australia Queensland' },
  { zone: 'Australia/Sydney', label: 'Australia Eastern' },
  { zone: 'Pacific/Auckland', label: 'New Zealand' },
];
export const PANEL_CLOSED_NOTE =
  '-# This panel has closed after 14 minutes without a click. Run `/raidsetup panel` to open it ' +
  'again.';

const PREFIX = 'raidsetup-panel';
// Dropdown values for "no weekly time" and "the raid reset's time zone": Discord cannot empty a
// dropdown once something is chosen, so these are choices of their own.
const NOT_WEEKLY = 'none';
const RESET_TIME_ZONE = 'reset';
// Discord's limits, in characters.
const DESCRIPTION_LIMIT = 4096;
// The result box's text, kept short so it and the panel fit Discord's 6000 characters for all of
// a message's embeds.
const RESULT_LIMIT = 1500;
const TITLE_LIMIT = 256;
const FORM_TITLE_LIMIT = 45;
const OPTION_LIMIT = 100;

// `context` is the raid context, from raidsContext().
export async function openPanel(interaction, context) {
  await new SetupPanel(interaction, context).open(context);
}

// One open panel. `view` is what it shows:
//   home    the settings and events, with Add event and Settings
//   event   one event, with its forms and Remove
//   remove  the question whether to remove that event
//   draft   a new event between its two forms; it is saved only when the second is submitted
class SetupPanel {
  #base;
  #userId;
  // The interaction last answered with the panel: only through it can the panel be changed.
  #latest;
  #collector;
  #idleTimer;
  #closed = false;
  #view = 'home';
  #eventId = null;
  #draft = null;
  // The result of the last change, shown in a box above the panel: from saved(), refused() or
  // unchanged().
  #result = null;
  // Form values that were refused, by form ("basics:new", "schedule:12", "settings"), so the form
  // opens with them again.
  #unsaved = new Map();

  constructor(interaction, { guild, member, guildConfig }) {
    this.#base = { guild, member, guildConfig };
    this.#userId = interaction.user.id;
    this.#latest = interaction;
  }

  async open(context) {
    const reply = await sendPrivate(this.#latest, this.#message(context));
    this.#collector = reply.message.createMessageComponentCollector({
      filter: (component) => component.user.id === this.#userId,
    });
    this.#collector.on('collect', (component) => this.#onComponent(component));
    this.#collector.on('end', (_, reason) => this.#onEnd(reason));
    this.#restartIdleTimer();
  }

  // Closes the panel PANEL_IDLE_MS from now. Restarted whenever the panel answers, since that
  // starts Discord's 15 minutes again; a form opened and dismissed does not.
  #restartIdleTimer() {
    clearTimeout(this.#idleTimer);
    if (this.#closed) return;
    this.#idleTimer = setTimeout(() => this.#collector.stop('idle'), PANEL_IDLE_MS);
    this.#idleTimer.unref?.();
  }

  async #onComponent(component) {
    try {
      const context = await this.#context(component);
      if (!context) return;
      const action = component.customId.slice(PREFIX.length + 1);
      await this.#handle(action, component, context);
    } catch (error) {
      logger.error({ err: error, userId: this.#userId }, 'Raid setup panel failed');
      // A click already answered (with a form, say) can no longer be; the panel still can be.
      const target = component.deferred || component.replied ? this.#latest : component;
      await respond(target, {
        content: COMMAND_ERROR_MESSAGE,
        flags: MessageFlags.Ephemeral,
      }).catch((replyError) => {
        logger.error({ err: replyError }, 'Failed to tell the user that the panel failed');
      });
    }
  }

  // The raid context for a click or form, read again so changes made meanwhile show, or null
  // when the user may no longer change the setup; the panel then closes.
  async #context(interaction) {
    const member = interaction.member ?? this.#base.member;
    const { error, context } = raidsContext(interaction, { ...this.#base, member });
    const refusal =
      error ?? (isOfficer(member, this.#base.guildConfig) ? null : NO_PERMISSION_MESSAGE);
    if (!refusal) return context;
    this.#closed = true;
    this.#collector.stop('refused');
    await this.#answer(interaction, { content: refusal, embeds: [], components: [] });
    return null;
  }

  async #handle(action, component, context) {
    const find = () => context.setup.events.find((event) => event.id === this.#eventId);
    switch (action) {
      case 'choose':
        this.#show('event', Number(component.values[0]));
        return this.#answer(component, this.#message(context));
      case 'back':
        this.#show('home');
        return this.#answer(component, this.#message(context));
      case 'add':
        return this.#form(component, context, 'basics', null);
      case 'next':
        return this.#form(component, context, 'schedule', null);
      case 'cancel-draft':
        this.#show('home');
        this.#result = this.#draft ? unchanged(`${this.#draft.name} was not added`) : null;
        this.#draft = null;
        this.#unsaved.delete('schedule:new');
        return this.#answer(component, this.#message(context));
      case 'settings':
        return this.#form(component, context, 'settings', null);
      case 'basics':
      case 'schedule':
        return this.#form(component, context, action, this.#eventId);
      case 'remove':
        this.#show('remove', this.#eventId);
        return this.#answer(component, this.#message(context));
      case 'remove-cancel':
        this.#show('event', this.#eventId);
        return this.#answer(component, this.#message(context));
      case 'remove-confirm': {
        const event = find();
        if (event) {
          // Raid-Helper is asked for the sheets already posted, which may take a while.
          await component.deferUpdate();
          this.#answered(component);
          const result = await deleteEvent(context, event);
          this.#show('home');
          this.#result = result.error
            ? refused(result.error, { title: 'Not removed' })
            : saved(`Removed ${event.name}`, result.notes);
        }
        return this.#answer(component, this.#message(context));
      }
      default:
        throw new Error(`Unknown raid setup panel action "${action}"`);
    }
  }

  // Switches to `view`, clearing the result of the last change.
  #show(view, eventId = null) {
    this.#view = view;
    this.#eventId = eventId;
    this.#result = null;
  }

  // Opens `kind`'s form for the event `eventId` (null for a new event, or for the settings) and
  // saves what is submitted.
  async #form(component, context, kind, eventId) {
    const event = eventId === null ? null : context.setup.events.find((e) => e.id === eventId);
    if (eventId !== null && !event) return this.#answer(component, this.#message(context));
    const key = `${kind}:${eventId ?? 'new'}`;
    const form = FORMS[kind];
    const formId = `${PREFIX}:form:${component.id}`;
    const values = this.#unsaved.get(key) ?? form.values({ context, event, userId: this.#userId });
    const name = event?.name ?? this.#draft?.name;
    await component.showModal(form.build(formId, { values, context, name }));

    let submit;
    try {
      submit = await component.awaitModalSubmit({
        filter: (candidate) => candidate.customId === formId && candidate.user.id === this.#userId,
        time: PANEL_IDLE_MS,
      });
    } catch {
      // Closed, or left open too long; nothing to answer.
      return undefined;
    }
    // Saving may ask Raid-Helper for the sheets already posted, which may take a while.
    await submit.deferUpdate();
    this.#answered(submit);
    const fresh = await this.#context(submit);
    if (!fresh) return undefined;

    const raw = form.read(submit.fields);
    const result = await this.#save(kind, eventId, raw, fresh);
    if (result.error) {
      this.#unsaved.set(key, raw);
      this.#result = refused(result.error, {
        button: result.retry === false ? null : retryButton(kind, eventId),
      });
    } else {
      this.#unsaved.delete(key);
    }
    return this.#answer(submit, this.#message(fresh));
  }

  // Saves a submitted form. Returns { error } or {}, after setting the view and result to show.
  async #save(kind, eventId, raw, context) {
    if (kind === 'settings') {
      const checked = settingsPatch(raw);
      if (checked.error) return checked;
      const result = saveSettings(context, checked.patch);
      if (result.error) return result;
      this.#result = result.changes.length
        ? saved('Saved the raid settings', result.notes)
        : unchanged('Nothing was changed');
      return {};
    }

    const checked = kind === 'basics' ? basicsFields(raw) : scheduleFields(raw);
    if (checked.error) return checked;
    const { fields } = checked;

    if (eventId === null && kind === 'basics') {
      const problem = newEventProblem(context, fields);
      if (problem) return { error: problem };
      this.#draft = fields;
      this.#show('draft');
      return {};
    }

    if (eventId === null) {
      if (!this.#draft) {
        return { error: 'Nothing was added: the new event was cancelled.', retry: false };
      }
      const result = saveNewEvent(context, { ...this.#draft, ...fields });
      if (result.error) return result;
      this.#draft = null;
      this.#unsaved.delete('basics:new');
      this.#show('event', result.event.id);
      this.#result = saved(`Added ${result.event.name}`, result.notes);
      return {};
    }

    const current = context.setup.events.find((event) => event.id === eventId);
    if (!current) return { error: 'That raid event no longer exists.', retry: false };
    // The form shows every field it has, so an empty field clears it.
    const replaced = kind === 'basics' ? BASICS_FIELDS : SCHEDULE_FIELDS;
    const result = await saveEventChange(context, current, (stored) => {
      const kept = Object.fromEntries(
        Object.entries(stored).filter(([field]) => !replaced.includes(field)),
      );
      const updated = { ...kept, ...fields };
      // The form shows a \n typed in /raidsetup as a new line; unedited, it stays as typed.
      if (stored.description && fields.description === expandLineBreaks(stored.description)) {
        updated.description = stored.description;
      }
      return { updated };
    });
    if (result.error) return result;
    this.#show('event', eventId);
    this.#result = result.unchanged
      ? unchanged('Nothing was changed')
      : saved(`Saved ${result.event.name}`, result.notes);
    return {};
  }

  // Answers a click or form with `payload`, and remembers the interaction to change the panel
  // through later.
  async #answer(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.update(payload);
    }
    this.#answered(interaction);
  }

  #answered(interaction) {
    this.#latest = interaction;
    this.#restartIdleTimer();
  }

  #onEnd(reason) {
    clearTimeout(this.#idleTimer);
    if (reason === 'refused') return;
    this.#closed = true;
    // The panel and the result box stay as they were.
    this.#latest
      .editReply({ content: PANEL_CLOSED_NOTE, components: [], allowedMentions: NO_MENTIONS })
      .catch((error) => {
        logger.debug({ err: error }, 'Could not close the raid setup panel');
      });
  }

  // The panel message for the current view, with the setup read again.
  #message({ store, guildConfig }) {
    const setup = loadSetup(store, guildConfig, Math.floor(Date.now() / 1000));
    let event = setup.events.find((candidate) => candidate.id === this.#eventId);
    if ((this.#view === 'event' || this.#view === 'remove') && !event) {
      this.#show('home');
      this.#result = unchanged(
        'That raid event no longer exists',
        'Another Officer may have removed it.',
      );
      event = undefined;
    }

    let embed;
    let rows;
    if (this.#view === 'event') ({ embed, rows } = eventView(event, setup));
    else if (this.#view === 'remove') ({ embed, rows } = removeView(event));
    else if (this.#view === 'draft') ({ embed, rows } = draftView(this.#draft, setup));
    else ({ embed, rows } = homeView(setup));

    return {
      content: this.#closed ? PANEL_CLOSED_NOTE : '',
      embeds: this.#result ? [resultEmbed(this.#result), embed] : [embed],
      components: this.#closed ? [] : rows,
      allowedMentions: NO_MENTIONS,
    };
  }
}

// The kinds of result shown above the panel, each in its own colour.
function saved(title, notes = []) {
  return { color: Colors.Green, title: `✅ ${title}`, text: notes.join('\n\n') };
}

// `button` is the panel button that opens the refused form again, with what was typed.
function refused(reason, { title = 'Not saved', button = null } = {}) {
  const hint = button ? `\n\nPress **${button}** to fix it; the form keeps what you typed.` : '';
  return { color: Colors.Red, title: `❌ ${title}`, text: reason + hint };
}

function unchanged(title, text = '') {
  return { color: Colors.Grey, title, text };
}

function resultEmbed({ color, title, text }) {
  const embed = new EmbedBuilder().setColor(color).setTitle(truncate(title, TITLE_LIMIT));
  return text ? embed.setDescription(truncate(text, RESULT_LIMIT)) : embed;
}

// The panel button that opens `kind`'s form for the event `eventId` (null for a new event).
function retryButton(kind, eventId) {
  if (kind === 'settings') return 'Settings';
  if (kind === 'basics') return eventId === null ? 'Add event' : 'Basics';
  return eventId === null ? 'Next' : 'Schedule & text';
}

function homeView(setup) {
  const settings = [
    `Time zone: ${setup.timeZone}${setup.timeZoneSetting ? '' : ' (from the raid reset)'} · ` +
      `Roster role: ${setup.raiderRoleId ? `<@&${setup.raiderRoleId}>` : 'none'} · ` +
      `Absences: ${setup.absenceChannelId ? `<#${setup.absenceChannelId}>` : 'not set'}`,
    `Reminders: ${reminderText(setup.reminderHours)} · ` +
      `Member DMs: ${setup.memberDms ? 'on' : 'off'}`,
  ];
  const events = setup.events.length
    ? setup.events.map((event) => `• ${eventLine(event)}`)
    : ['No raid events yet. Add one with **Add event**.'];
  const embed = new EmbedBuilder()
    .setTitle('Raid setup')
    .setDescription(
      truncate(
        [...settings, '', `**Events (${setup.events.length})**`, ...events].join('\n'),
        DESCRIPTION_LIMIT,
      ),
    );

  const rows = [];
  if (setup.events.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:choose`)
          .setPlaceholder('Choose an event to change or remove…')
          .addOptions(
            setup.events.map((event) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(truncate(event.name, OPTION_LIMIT))
                .setValue(String(event.id))
                .setDescription(truncate(weeklyText(event), OPTION_LIMIT)),
            ),
          ),
      ),
    );
  }
  rows.push(
    new ActionRowBuilder().addComponents(
      button('add', 'Add event', ButtonStyle.Primary).setDisabled(
        setup.events.length >= MAX_EVENTS,
      ),
      button('settings', 'Settings', ButtonStyle.Secondary),
    ),
  );
  return { embed, rows };
}

function eventView(event, setup) {
  const embed = new EmbedBuilder()
    .setTitle(truncate(event.name, TITLE_LIMIT))
    .setDescription(truncate(eventSummary(event, setup, setup.timeZone), DESCRIPTION_LIMIT));
  const rows = [
    new ActionRowBuilder().addComponents(
      button('basics', 'Basics', ButtonStyle.Primary),
      button('schedule', 'Schedule & text', ButtonStyle.Primary),
      button('remove', 'Remove', ButtonStyle.Danger),
      button('back', 'Back', ButtonStyle.Secondary),
    ),
  ];
  return { embed, rows };
}

function removeView(event) {
  const embed = new EmbedBuilder()
    .setTitle(truncate(`Remove ${event.name}?`, TITLE_LIMIT))
    .setDescription(
      'It is no longer posted or offered in `/raid create`. Sign-up sheets already posted stay ' +
        'in Raid-Helper and keep their reminders until they start.',
    );
  const rows = [
    new ActionRowBuilder().addComponents(
      button('remove-confirm', 'Remove', ButtonStyle.Danger),
      button('remove-cancel', 'Cancel', ButtonStyle.Secondary),
    ),
  ];
  return { embed, rows };
}

function draftView(draft, setup) {
  const roleId = draft.raiderRoleId ?? setup.raiderRoleId;
  const embed = new EmbedBuilder()
    .setTitle(truncate(`New event: ${draft.name}`, TITLE_LIMIT))
    .setDescription(
      [
        `Posts in <#${draft.channelId}> with template \`${escapeMarkdown(draft.templateId)}\`; ` +
          `leader <@${draft.leaderId}>`,
        `Roster: <@&${roleId}>${draft.raiderRoleId ? '' : ' (shared)'}`,
        '',
        '**Step 2 of 2:** the weekly time, title and description. Choose **Not weekly** to post ' +
          'it only with `/raid create`. Nothing is saved until you submit it.',
      ].join('\n'),
    );
  const rows = [
    new ActionRowBuilder().addComponents(
      button('next', 'Next', ButtonStyle.Primary),
      button('cancel-draft', 'Cancel', ButtonStyle.Secondary),
    ),
  ];
  return { embed, rows };
}

function button(action, label, style) {
  return new ButtonBuilder().setCustomId(`${PREFIX}:${action}`).setLabel(label).setStyle(style);
}

// "Molten Core: #20-man · Wednesdays 19:30, posted when the previous raid starts · leader @Booth".
function eventLine(event) {
  return [
    `**${escapeMarkdown(event.name)}**: <#${event.channelId}>`,
    weeklyText(event),
    `leader <@${event.leaderId}>`,
    ...(event.raiderRoleId ? [`roster <@&${event.raiderRoleId}>`] : []),
  ].join(' · ');
}

function weeklyText({ weekly }) {
  if (!weekly) return 'Only with /raid create';
  return `${capitalize(weekly.weekday)}s ${weekly.time}, posted ${postAfterText(weekly.postAfterHours)}`;
}

function reminderText(hours) {
  if (hours.length === 0) return 'when sign-ups close';
  return `${hours.join(', ')} hours before, and when sign-ups close`;
}

// The panel's forms. Each has:
//   values({ context, event, userId })  what it opens with: the event's or settings' values
//   build(formId, { values, context, name })  the modal
//   read(fields)  the submitted values, in the shape values() returns
const FORMS = {
  basics: {
    values: ({ context, event, userId }) =>
      event
        ? {
            name: event.name,
            channelId: event.channelId,
            templateId: event.templateId,
            leaderId: event.leaderId,
            raiderRoleId: event.raiderRoleId ?? null,
          }
        : { templateId: mostUsedTemplate(context), leaderId: userId },

    build: (formId, { values, context, name }) => {
      const nameInput = textInput('name', TextInputStyle.Short).setMaxLength(100);
      setValue(nameInput, values.name);
      const channel = new ChannelSelectMenuBuilder()
        .setCustomId('channel')
        .setChannelTypes(...RAID_CHANNEL_TYPES);
      if (values.channelId) channel.setDefaultChannels(values.channelId);
      const template = textInput('template', TextInputStyle.Short)
        .setMaxLength(50)
        .setPlaceholder('A Raid-Helper template ID');
      setValue(template, values.templateId);
      const leader = new UserSelectMenuBuilder().setCustomId('leader');
      if (values.leaderId) leader.setDefaultUsers(values.leaderId);
      const role = new RoleSelectMenuBuilder()
        .setCustomId('role')
        .setRequired(false)
        .setMinValues(0);
      if (values.raiderRoleId) role.setDefaultRoles(values.raiderRoleId);
      const shared = context.setup.raiderRoleId
        ? 'Leave empty to use the shared roster role.'
        : 'There is no shared roster role, so choose one.';

      return new ModalBuilder()
        .setCustomId(formId)
        .setTitle(formTitle(name ? `${name}: basics` : 'New raid event (1 of 2)'))
        .addLabelComponents(
          label(
            'Name',
            'Shown in /raid create, and the sheet title unless one is set',
          ).setTextInputComponent(nameInput),
          label(
            'Sign-up channel',
            'Where Raid-Helper posts the sign-up sheets',
          ).setChannelSelectMenuComponent(channel),
          label(
            'Template ID',
            'A Raid-Helper template, e.g. one used on this server',
          ).setTextInputComponent(template),
          label('Leader', 'Gets the missing sign-ups reports by DM').setUserSelectMenuComponent(
            leader,
          ),
          label('Roster role', `Members expected to sign up. ${shared}`).setRoleSelectMenuComponent(
            role,
          ),
        );
    },

    read: (fields) => {
      const leader = fields.getSelectedUsers('leader')?.first();
      return {
        name: fields.getTextInputValue('name').trim(),
        channelId: fields.getSelectedChannels('channel')?.first()?.id ?? null,
        templateId: fields.getTextInputValue('template').trim(),
        leaderId: leader?.id ?? null,
        leaderIsBot: Boolean(leader?.bot),
        raiderRoleId: fields.getSelectedRoles('role')?.first()?.id ?? null,
      };
    },
  },

  schedule: {
    values: ({ event }) => ({
      weekday: event?.weekly?.weekday ?? null,
      time: event?.weekly?.time ?? '',
      postAfterHours: event?.weekly?.postAfterHours ?? DEFAULT_POST_AFTER_HOURS,
      title: event?.title ?? '',
      // Typed in /raidsetup, a new line is \n.
      description: expandLineBreaks(event?.description ?? ''),
    }),

    build: (formId, { values, context, name }) => {
      const weekday = new StringSelectMenuBuilder().setCustomId('weekday').addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('Not weekly')
          .setValue(NOT_WEEKLY)
          .setDescription('Posted only with /raid create')
          .setDefault(!values.weekday),
        ...WEEKDAYS.map((day) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(capitalize(day))
            .setValue(day)
            .setDefault(day === values.weekday),
        ),
      );
      const time = textInput('time', TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(5)
        .setPlaceholder('19:30');
      setValue(time, values.time);
      const postAfter = new StringSelectMenuBuilder().setCustomId('post-after').addOptions(
        POST_AFTER_HOURS.map((hours) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(capitalize(postAfterText(hours)))
            .setValue(String(hours))
            .setDefault(hours === values.postAfterHours),
        ),
      );
      const title = textInput('title', TextInputStyle.Short).setRequired(false).setMaxLength(100);
      setValue(title, values.title);
      const description = textInput('description', TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000);
      setValue(description, values.description);

      return new ModalBuilder()
        .setCustomId(formId)
        .setTitle(formTitle(name ? `${name}: schedule and text` : 'New raid event (2 of 2)'))
        .addLabelComponents(
          label(
            'Weekly day',
            'The day the bot posts it for every week, or Not weekly',
          ).setStringSelectMenuComponent(weekday),
          label(
            'Weekly start time',
            `24-hour time in ${context.setup.timeZone}, e.g. 19:30; unused when not weekly`,
          ).setTextInputComponent(time),
          label(
            'Post the sheet',
            "When each week's sheet goes up, e.g. once the previous raid is over",
          ).setStringSelectMenuComponent(postAfter),
          label('Sheet title', `Empty for the name. ${TITLE_HELP}`).setTextInputComponent(title),
          label('Sheet description', 'Optional').setTextInputComponent(description),
        );
    },

    read: (fields) => ({
      weekday: weeklyDay(fields.getStringSelectValues('weekday')[0]),
      time: fields.getTextInputValue('time').trim(),
      postAfterHours: Number(
        fields.getStringSelectValues('post-after')[0] ?? DEFAULT_POST_AFTER_HOURS,
      ),
      title: fields.getTextInputValue('title').trim(),
      description: fields.getTextInputValue('description').trim(),
    }),
  },

  settings: {
    values: ({ context: { setup } }) => ({
      absenceChannelId: setup.absenceChannelId,
      raiderRoleId: setup.raiderRoleId,
      timeZone: setup.timeZoneSetting,
      reminderHours: setup.reminderHours.join(', '),
      memberDms: setup.memberDms,
    }),

    build: (formId, { values, context }) => {
      const absences = new ChannelSelectMenuBuilder()
        .setCustomId('absence-channel')
        .setChannelTypes(...RAID_CHANNEL_TYPES)
        .setRequired(false)
        .setMinValues(0);
      if (values.absenceChannelId) absences.setDefaultChannels(values.absenceChannelId);
      const role = new RoleSelectMenuBuilder()
        .setCustomId('roster-role')
        .setRequired(false)
        .setMinValues(0);
      if (values.raiderRoleId) role.setDefaultRoles(values.raiderRoleId);
      const zones = COMMON_TIME_ZONES.some(({ zone }) => zone === values.timeZone)
        ? COMMON_TIME_ZONES
        : [
            ...(values.timeZone ? [{ zone: values.timeZone, label: values.timeZone }] : []),
            ...COMMON_TIME_ZONES,
          ];
      const resetZone = (context.guildConfig.raidReset ?? DEFAULT_RAID_RESET).timeZone;
      const timeZone = new StringSelectMenuBuilder().setCustomId('time-zone').addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('From the raid reset')
          .setValue(RESET_TIME_ZONE)
          .setDescription(resetZone)
          .setDefault(!values.timeZone),
        ...zones.map(({ zone, label: name }) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(name)
            .setValue(zone)
            .setDescription(zone)
            .setDefault(zone === values.timeZone),
        ),
      );
      const hours = textInput('reminder-hours', TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder('48, 24');
      setValue(hours, values.reminderHours);
      const memberDms = new StringSelectMenuBuilder()
        .setCustomId('member-dms')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Off')
            .setValue('off')
            .setDefault(!values.memberDms),
          new StringSelectMenuOptionBuilder()
            .setLabel('On: DM each missing member too')
            .setValue('on')
            .setDefault(values.memberDms),
        );

      return new ModalBuilder()
        .setCustomId(formId)
        .setTitle('Raid settings')
        .addLabelComponents(
          label(
            'Absences channel',
            'Where /absence add posts; absences are off until it is set',
          ).setChannelSelectMenuComponent(absences),
          label(
            'Shared roster role',
            'Members expected to sign up for events without a role',
          ).setRoleSelectMenuComponent(role),
          label('Time zone', 'Raid times and dates are read in it').setStringSelectMenuComponent(
            timeZone,
          ),
          label(
            'Reminder hours',
            'Hours before each raid to report missing sign-ups, e.g. 48, 24; empty for none',
          ).setTextInputComponent(hours),
          label(
            'Member DMs',
            'Also DM each member who has not signed up',
          ).setStringSelectMenuComponent(memberDms),
        );
    },

    read: (fields) => ({
      absenceChannelId: fields.getSelectedChannels('absence-channel')?.first()?.id ?? null,
      raiderRoleId: fields.getSelectedRoles('roster-role')?.first()?.id ?? null,
      timeZone: settingsTimeZone(fields.getStringSelectValues('time-zone')[0]),
      reminderHours: fields.getTextInputValue('reminder-hours').trim(),
      memberDms: fields.getStringSelectValues('member-dms')[0] === 'on',
    }),
  },
};

// The event fields each event form shows, and so replaces.
const BASICS_FIELDS = ['name', 'channelId', 'templateId', 'leaderId', 'raiderRoleId'];
const SCHEDULE_FIELDS = ['weekly', 'title', 'description'];

// The submitted basics as event fields: { fields } or { error }.
function basicsFields(raw) {
  if (!raw.name) return { error: 'The name must not be blank.' };
  if (!raw.channelId) return { error: 'Choose a sign-up channel.' };
  if (!raw.templateId) return { error: 'The template ID must not be blank.' };
  if (!raw.leaderId) return { error: 'Choose a leader.' };
  if (raw.leaderIsBot) return { error: LEADER_BOT_MESSAGE };
  return {
    fields: {
      name: raw.name,
      channelId: raw.channelId,
      templateId: raw.templateId,
      leaderId: raw.leaderId,
      ...(raw.raiderRoleId && { raiderRoleId: raw.raiderRoleId }),
    },
  };
}

// The submitted schedule and text as event fields: { fields } or { error }.
function scheduleFields(raw) {
  const fields = {};
  // Not weekly: a time left in the form is not used.
  if (raw.weekday) {
    if (!raw.time) {
      return {
        error:
          'A weekly event needs a start time. Choose **Not weekly** to post it only with ' +
          '`/raid create`.',
      };
    }
    const time = parseTimeInput(raw.time);
    if (!time) {
      return {
        error: `"${escapeMarkdown(raw.time)}" is not a time. Use a 24-hour time such as 19:30.`,
      };
    }
    fields.weekly = { weekday: raw.weekday, time, postAfterHours: raw.postAfterHours };
  }
  if (raw.title) {
    const problem = titleProblem(raw.title);
    if (problem) return { error: problem };
    fields.title = raw.title;
  }
  if (raw.description) fields.description = raw.description;
  return { fields };
}

// The submitted settings as a patch of every setting: { patch } or { error }.
function settingsPatch(raw) {
  const hours = raw.reminderHours ? parseReminderHours(raw.reminderHours) : { hours: [] };
  if (hours.error) return hours;
  const timeZone = raw.timeZone && canonicalTimeZone(raw.timeZone);
  if (raw.timeZone && !timeZone) return { error: `"${raw.timeZone}" is not a time zone.` };
  return {
    patch: {
      absenceChannelId: raw.absenceChannelId,
      raiderRoleId: raw.raiderRoleId,
      timeZone: timeZone || null,
      reminderHours: hours.hours,
      memberDms: raw.memberDms,
    },
  };
}

// The weekday chosen in the schedule form, or null for Not weekly.
function weeklyDay(value) {
  return !value || value === NOT_WEEKLY ? null : value;
}

// The time zone chosen in the settings form, or null for the raid reset's.
function settingsTimeZone(value) {
  return !value || value === RESET_TIME_ZONE ? null : value;
}

// The template most of the server's events and posted sheets use, for a new event's form.
function mostUsedTemplate({ guild, setup, scheduler }) {
  const counts = new Map();
  const templates = [
    ...setup.events.map((event) => event.templateId),
    ...(scheduler?.upcomingEvents(guild.id) ?? []).map((event) => event.templateId),
  ].filter(Boolean);
  for (const templateId of templates) counts.set(templateId, (counts.get(templateId) ?? 0) + 1);
  let best = '';
  for (const [templateId, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = templateId;
  }
  return best;
}

function textInput(customId, style) {
  return new TextInputBuilder().setCustomId(customId).setStyle(style);
}

// Discord refuses an empty prefilled value.
function setValue(input, value) {
  if (value) input.setValue(value);
}

function label(text, description) {
  return new LabelBuilder().setLabel(text).setDescription(description);
}

function formTitle(text) {
  return truncate(text, FORM_TITLE_LIMIT);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
