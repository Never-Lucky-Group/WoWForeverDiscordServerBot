import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { truncate } from '../lib/text.js';
import { eventUrl } from './schedule.js';

// Discord's embed limits, in characters.
const TITLE_LIMIT = 256;
const FIELD_VALUE_LIMIT = 1024;

// The missing sign-ups report for an event. Names are plain display names rather than mentions,
// which often show as "@unknown-user" in DMs.
//   roleId      the roster role that was checked, from rosterRoleId()
//   rosterSize  how many members have that role
//   sorted      from sortRaiders()
//   reason      why it was sent, e.g. '24-hour reminder', from reminderReason()
//   next        for the leader's DM: when the next report comes, from nextReport()
//   checkedAt   when the sign-ups were checked (ms), shown by Discord in each viewer's time zone
//   forLeader   whether it is the DM to the event leader rather than a /raid missing reply
//   dms         optional { sent: members, failed: members } when members were DMed
export function reportEmbed({
  guild,
  event,
  roleId,
  rosterSize,
  sorted,
  reason,
  next,
  forLeader = false,
  checkedAt,
  dms,
}) {
  // null when the channel has no roster role at all; a role deleted in Discord has no name.
  const roleName = roleId
    ? escapeMarkdown(guild.roles.cache.get(roleId)?.name ?? 'a deleted role')
    : null;
  const guildName = escapeMarkdown(guild.name);
  const opening = forLeader ? `You lead this event in **${guildName}**.` : `**${guildName}**:`;
  const legend = sorted.absent.length ? ['Absent = recorded with /absence'] : [];
  const footer = forLeader
    ? [reason, ...legend, 'Run /raid missing for an update', next]
    : [reason, ...legend];

  const embed = new EmbedBuilder()
    .setTitle(truncate(`Missing sign-ups: ${event.title}`, TITLE_LIMIT))
    .setURL(eventUrl(guild.id, event))
    .setDescription(
      `${opening} ${rosterSummary(sorted.missing.length, rosterSize, roleName)}\n` +
        `<t:${event.startTime}:F> (<t:${event.startTime}:R>)`,
    )
    .setFooter({ text: footer.filter(Boolean).join(' · ') })
    .setTimestamp(checkedAt);

  embed.addFields({
    name: `Not signed up (${sorted.missing.length})`,
    value: sorted.missing.length ? nameList(sorted.missing) : 'Everyone has signed up.',
  });
  if (sorted.tentative.length) {
    embed.addFields({
      name: `Tentative (${sorted.tentative.length})`,
      value: nameList(sorted.tentative),
    });
  }
  if (sorted.absent.length) {
    embed.addFields({ name: `Absent (${sorted.absent.length})`, value: nameList(sorted.absent) });
  }
  if (sorted.conflicts.length) {
    embed.addFields({
      name: `Signed up, but has an absence (${sorted.conflicts.length})`,
      value: nameList(sorted.conflicts),
    });
  }
  if (dms?.sent.length) {
    embed.addFields({ name: `DMed (${dms.sent.length})`, value: nameList(dms.sent) });
  }
  if (dms?.failed.length) {
    embed.addFields({
      name: `Could not DM (${dms.failed.length})`,
      value: nameList(dms.failed),
    });
  }
  return embed;
}

// Display names separated by commas, cut short with "… and N more" to fit an embed field.
export function nameList(members) {
  const names = members.map((member) => escapeMarkdown(member.displayName));
  let text = names.join(', ');
  if (text.length <= FIELD_VALUE_LIMIT) return text;

  for (let shown = names.length - 1; shown > 0; shown--) {
    text = `${names.slice(0, shown).join(', ')} … and ${names.length - shown} more`;
    if (text.length <= FIELD_VALUE_LIMIT) return text;
  }
  return `${names.length} members`;
}

// How many of the roster have not signed up, e.g. "3 of 15 members of **Roster** have not
// signed up."
function rosterSummary(missing, rosterSize, roleName) {
  if (!roleName) {
    return 'This channel has no roster role, so nobody is expected to sign up. An Officer can set one with `/raidsetup`.';
  }
  const members = `member${rosterSize === 1 ? '' : 's'} of **${roleName}**`;
  if (rosterSize === 0) return `Nobody has the **${roleName}** role.`;
  if (missing === 0) {
    return rosterSize === 1
      ? `The only member of **${roleName}** has signed up or recorded an absence.`
      : `All ${rosterSize} ${members} have signed up or recorded an absence.`;
  }
  return `${missing} of ${rosterSize} ${members} ${missing === 1 ? 'has' : 'have'} not signed up.`;
}

// Why a report was sent at a reminder point from reminderPoints().
export function reminderReason(point) {
  return point.key === 'close' ? 'Sign-ups closed' : `${point.hours}-hour reminder`;
}

// When the report after `point` comes, from the event's reminder points (earliest first).
export function nextReport(points, point) {
  const next = points[points.findIndex((candidate) => candidate.key === point.key) + 1];
  if (!next) return 'Last report for this event';
  return next.key === 'close'
    ? 'Next report: when sign-ups close'
    : `Next report: ${next.hours} hours before the event`;
}
