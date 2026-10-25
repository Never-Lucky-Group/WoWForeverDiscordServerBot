import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  escapeMarkdown,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import { localDate } from '../lib/time.js';
import { formatDate } from './dates.js';
import { eventUrl, isConfiguredEvent } from './schedule.js';
import { loadSetup } from './setup.js';

// DMs to members who have not signed up for an event, with "Can make it" / "Can't make it"
// buttons. The buttons must keep working for days and across restarts, so they are not handled by
// a collector: interactionCreate passes every button whose custom ID starts with RSVP_PREFIX to
// handleRsvpButton(). The custom ID carries everything the handler needs.

export const RSVP_PREFIX = 'raid-rsvp';
export const STALE_MESSAGE = 'This event has already started or no longer exists.';
export const UNAVAILABLE_MESSAGE = 'You can no longer answer this message.';
export const RAID_HELPER_DOWN_MESSAGE =
  'Raid-Helper could not be reached, so your answer was not saved. Please try again later.';

export function rsvpCustomId(guildId, eventId, answer) {
  return `${RSVP_PREFIX}:${guildId}:${eventId}:${answer}`;
}

// { guildId, eventId, answer } for an RSVP button's custom ID, or null for any other ID.
export function parseRsvpCustomId(customId) {
  const match = new RegExp(`^${RSVP_PREFIX}:(\\d+):(\\d+):(yes|no)$`).exec(customId);
  return match ? { guildId: match[1], eventId: match[2], answer: match[3] } : null;
}

export function rsvpMessage(guild, event) {
  return {
    content:
      `**${escapeMarkdown(guild.name)}**: you have not signed up for ` +
      `**${escapeMarkdown(event.title)}** on <t:${event.startTime}:F> yet. Can you make it?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(rsvpCustomId(guild.id, event.id, 'yes'))
          .setLabel('Can make it')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(rsvpCustomId(guild.id, event.id, 'no'))
          .setLabel("Can't make it")
          .setStyle(ButtonStyle.Danger),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// DMs each member who has not been DMed about the event yet. Returns { sent, failed } (members).
// A member whose DM failed (e.g. DMs from server members are off) is tried again at the next
// reminder.
export async function dmMissingMembers({ store, guild, event, members, now }) {
  const alreadyDmed = store.dmedUserIds(guild.id, event.id);
  const result = { sent: [], failed: [] };
  for (const member of members) {
    if (alreadyDmed.has(member.id)) continue;
    try {
      await member.send(rsvpMessage(guild, event));
      store.recordMemberDm(
        guild.id,
        { eventId: event.id, userId: member.id, startTime: event.startTime },
        now,
      );
      result.sent.push(member);
    } catch (error) {
      logger.debug(
        { guildId: guild.id, eventId: event.id, userId: member.id, err: error },
        'Could not DM a member about a missing sign-up',
      );
      result.failed.push(member);
    }
  }
  return result;
}

// Handles a press of "Can make it" or "Can't make it". "Can't make it" stores an absence for the
// event's date, which takes the member off later reports.
export async function handleRsvpButton(interaction, now = Date.now()) {
  const parsed = parseRsvpCustomId(interaction.customId);
  if (!parsed) return;
  const { client } = interaction;
  const guildConfig = client.botConfig.guilds.get(parsed.guildId);
  const guild = client.guilds.cache.get(parsed.guildId);
  const member = guild?.members.cache.get(interaction.user.id);
  const raids = client.raids;
  if (!raids?.store || !raids.apiKeys.has(parsed.guildId) || !guildConfig || !guild || !member) {
    await interaction.reply({ content: UNAVAILABLE_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  // Raid-Helper may take longer than Discord's 3-second reply deadline.
  await interaction.deferUpdate();
  let event;
  try {
    event = await raids.api.getEvent(parsed.eventId);
  } catch (error) {
    logger.warn(
      { guildId: guild.id, eventId: parsed.eventId, err: error },
      'Could not fetch a Raid-Helper event for a DM answer',
    );
    await interaction.followUp({ content: RAID_HELPER_DOWN_MESSAGE });
    return;
  }

  const nowSeconds = Math.floor(now / 1000);
  const setup = loadSetup(raids.store, guildConfig, nowSeconds);
  if (!event || !isConfiguredEvent(event, setup, guild.id) || event.startTime <= nowSeconds) {
    await interaction.editReply({ content: STALE_MESSAGE, components: [] });
    return;
  }

  const logInfo = { guildId: guild.id, eventId: event.id, userId: member.id };
  if (parsed.answer === 'yes') {
    raids.store.recordMemberAnswer(
      guild.id,
      { eventId: event.id, userId: member.id, answer: 'yes' },
      nowSeconds,
    );
    logger.info(logInfo, 'Member answered a DM: can make it');
    await interaction.editReply({
      content:
        `Great! Sign up for **${escapeMarkdown(event.title)}** on the event so the leader can ` +
        `plan the raid: ${eventUrl(guild.id, event)}`,
      components: [],
    });
    return;
  }

  const date = localDate(event.startTime, setup.timeZone);
  raids.store.addAbsence(
    guild.id,
    {
      userId: member.id,
      startsOn: date,
      endsOn: date,
      reason: `Can't make it to ${event.title}`.slice(0, 200),
      createdBy: member.id,
      source: 'dm',
    },
    nowSeconds,
  );
  raids.store.recordMemberAnswer(
    guild.id,
    { eventId: event.id, userId: member.id, answer: 'no' },
    nowSeconds,
  );
  logger.info(logInfo, "Member answered a DM: can't make it");
  await interaction.editReply({
    content:
      `Thanks for letting us know. You are marked absent on **${formatDate(date)}**, so you ` +
      'will not be reminded about this event again.',
    components: [],
  });
}
