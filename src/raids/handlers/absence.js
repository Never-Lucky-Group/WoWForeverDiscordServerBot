import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { NO_PERMISSION_MESSAGE } from '../../handlers/commandInteraction.js';
import { logger } from '../../lib/logger.js';
import { isOfficer } from '../../lib/membership.js';
import { addDaysToDate } from '../../lib/time.js';
import { sendPrivate } from '../../loot/discord/privateReply.js';
import { formatDateRange, parseDateInput, todayIn } from '../dates.js';
import { DATE_HELP } from './raid.js';

// How far ahead an absence may start.
export const MAX_DAYS_AHEAD = 365;
// The longest absence, in days with both ends included. Longer breaks are better handled by
// removing the raider role.
export const MAX_ABSENCE_DAYS = 90;
const DESCRIPTION_LIMIT = 4096;
const NO_MENTIONS = { parse: [] };

export const NO_ABSENCE_CHANNEL_MESSAGE =
  'The absences channel is not set yet, so absences cannot be recorded. Ask an Officer to set ' +
  'it with `/raidsetup settings set absence-channel`.';

// /absence add: stores an absence and posts it in the absences channel.
export async function addAbsence(interaction, context) {
  const { guild, member, guildConfig, setup, store, timeZone } = context;
  const now = Date.now();
  if (!setup.absenceChannelId) {
    await sendPrivate(interaction, { content: NO_ABSENCE_CHANNEL_MESSAGE });
    return;
  }
  const today = todayIn(timeZone, now);

  const fromText = interaction.options.getString('from', true);
  const startsOn = parseDateInput(fromText, timeZone, now);
  if (!startsOn) {
    await sendPrivate(interaction, { content: notADate(fromText) });
    return;
  }
  const toText = interaction.options.getString('to');
  // A `to` without a year is the next such date on or after `from`.
  const endsOn = toText ? parseDateInput(toText, timeZone, now, { onOrAfter: startsOn }) : startsOn;
  if (!endsOn) {
    await sendPrivate(interaction, { content: notADate(toText) });
    return;
  }
  if (endsOn < startsOn) {
    await sendPrivate(interaction, { content: '`to` must not be before `from`.' });
    return;
  }
  if (endsOn < today) {
    await sendPrivate(interaction, { content: 'That absence is already over.' });
    return;
  }
  if (endsOn > addDaysToDate(startsOn, MAX_ABSENCE_DAYS - 1)) {
    await sendPrivate(interaction, {
      content: `An absence can be at most ${MAX_ABSENCE_DAYS} days long.`,
    });
    return;
  }
  if (startsOn > addDaysToDate(today, MAX_DAYS_AHEAD)) {
    await sendPrivate(interaction, {
      content: `An absence can start at most ${MAX_DAYS_AHEAD} days from today.`,
    });
    return;
  }

  const target = targetMember(interaction, context);
  if (target.error) {
    await sendPrivate(interaction, { content: target.error });
    return;
  }
  const absentMember = target.member ?? member;
  const reason = interaction.options.getString('reason')?.trim() || null;

  const absence = store.addAbsence(
    guild.id,
    {
      userId: absentMember.id,
      startsOn,
      endsOn,
      reason,
      createdBy: member.id,
      source: 'command',
    },
    Math.floor(now / 1000),
  );
  logger.info(
    { guildId: guild.id, absenceId: absence.id, userId: absentMember.id, createdBy: member.id },
    'Recorded an absence',
  );

  const range = formatDateRange(startsOn, endsOn);
  const posted = await postAbsence(guild, setup.absenceChannelId, {
    text:
      `**Absence #${absence.id}**: <@${absentMember.id}> · ${range}` +
      (reason ? ` · ${escapeMarkdown(reason)}` : '') +
      (absentMember.id === member.id ? '' : ` (added by <@${member.id}>)`),
    logInfo: { guildId: guild.id, absenceId: absence.id },
  });

  const who = absentMember.id === member.id ? 'your' : `<@${absentMember.id}>'s`;
  await sendPrivate(interaction, {
    content:
      `Recorded ${who} absence #${absence.id}: **${range}**.` +
      (posted ? '' : ` It could not be posted in <#${setup.absenceChannelId}>.`) +
      (isOfficer(member, guildConfig) || absentMember.id !== member.id
        ? ''
        : ' Cancel it with `/absence cancel` if your plans change.'),
  });
}

// /absence list: upcoming absences. Members see their own; Officers see everyone's, or one
// member's with `member`.
export async function listAbsences(interaction, context) {
  const { guild, member, guildConfig, store, timeZone } = context;
  const officer = isOfficer(member, guildConfig);
  const user = interaction.options.getUser('member');
  if (user && user.id !== member.id && !officer) {
    await sendPrivate(interaction, { content: NO_PERMISSION_MESSAGE });
    return;
  }

  const userId = user?.id ?? (officer ? null : member.id);
  const absences = store.upcomingAbsences(guild.id, todayIn(timeZone), userId);
  const lines = absences.map(
    (absence) =>
      `**#${absence.id}** · <@${absence.userId}> · ${formatDateRange(absence.startsOn, absence.endsOn)}` +
      (absence.reason ? ` · ${escapeMarkdown(absence.reason)}` : ''),
  );
  const embed = new EmbedBuilder()
    .setTitle('Upcoming absences')
    .setDescription(lines.length ? fitLines(lines) : 'No upcoming absences.');
  await sendPrivate(interaction, { embeds: [embed] });
}

// /absence cancel: deletes an absence. Members may cancel their own; Officers anyone's.
export async function cancelAbsence(interaction, context) {
  const { guild, member, guildConfig, store } = context;
  const id = interaction.options.getInteger('id', true);
  const absence = store.getAbsence(guild.id, id);
  if (!absence || (absence.userId !== member.id && !isOfficer(member, guildConfig))) {
    await sendPrivate(interaction, { content: `There is no absence #${id} that you can cancel.` });
    return;
  }

  store.deleteAbsence(guild.id, id);
  logger.info(
    { guildId: guild.id, absenceId: id, userId: absence.userId, cancelledBy: member.id },
    'Cancelled an absence',
  );
  const whose = absence.userId === member.id ? '' : ` for <@${absence.userId}>`;
  await sendPrivate(interaction, {
    content:
      `Cancelled absence #${id}${whose} ` +
      `(${formatDateRange(absence.startsOn, absence.endsOn)}).`,
  });
}

// The member named in the `member` option: { member } (undefined when the option is not used, or
// names the user running the command) or { error }. Only Officers may name someone else.
function targetMember(interaction, { guild, member, guildConfig }) {
  const user = interaction.options.getUser('member');
  if (!user || user.id === member.id) return {};
  if (!isOfficer(member, guildConfig)) {
    return { error: 'Only Officers can add an absence for someone else.' };
  }
  const target = guild.members.cache.get(user.id);
  if (!target || target.user.bot) {
    return { error: `<@${user.id}> is not a member of this server.` };
  }
  return { member: target };
}

// Whether the message was posted. Never pings anyone.
async function postAbsence(guild, channelId, { text, logInfo }) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased()) {
    logger.warn({ ...logInfo, channelId }, 'The absences channel was not found');
    return false;
  }
  try {
    await channel.send({ content: text, allowedMentions: NO_MENTIONS });
    return true;
  } catch (error) {
    logger.warn(
      { ...logInfo, channelId, err: error },
      'Could not post an absence; the bot needs View Channel and Send Messages there',
    );
    return false;
  }
}

function notADate(text) {
  return `"${escapeMarkdown(text.trim())}" is not a date. ${DATE_HELP}`;
}

// Joins lines to fit an embed description, ending with "… and N more" if some do not fit.
function fitLines(lines) {
  let text = lines.join('\n');
  if (text.length <= DESCRIPTION_LIMIT) return text;
  for (let shown = lines.length - 1; shown > 0; shown--) {
    text = `${lines.slice(0, shown).join('\n')}\n… and ${lines.length - shown} more`;
    if (text.length <= DESCRIPTION_LIMIT) return text;
  }
  return `${lines.length} absences`;
}
