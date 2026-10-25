import { DEFAULT_RAID_RESET } from '../loot/raidWeeks.js';

// A server's raid setup, made with /raidsetup and stored in the raids database:
//   settings  { absenceChannelId, raiderRoleId, timeZone, reminderHours, memberDms }
//   events    the kinds of event the bot can post, from RaidStore.raidEvents()
//   watched   channels still checked after their event was removed or moved, from
//             RaidStore.watchedChannels()

export const DEFAULT_REMINDER_HOURS = [48, 24];
// A Discord dropdown or autocomplete list holds at most 25 options.
export const MAX_EVENTS = 25;
export const MAX_REMINDER_HOURS = 5;
// Reminders are sent at most a week before an event, the earliest a weekly sheet is posted.
export const MAX_REMINDER_HOUR = 168;

// When a weekly event's sheet is posted: this many hours after the previous week's raid starts
// (weekly.postAfterHours), so a guild can post the next sheet once tonight's raid is over. The
// panel and /raidsetup offer these choices.
export const POST_AFTER_HOURS = [0, 1, 2, 3, 4, 5, 6, 8, 12, 24, 48, 72, 96, 120, 144];
export const DEFAULT_POST_AFTER_HOURS = 0;
const WEEK_HOURS = 7 * 24;

// How many hours before a weekly event starts its sheet is posted (ignoring daylight saving).
export function postLeadHours(weekly) {
  return WEEK_HOURS - weekly.postAfterHours;
}

// "when the previous raid starts", "3 hours after the previous raid starts", "2 days after …".
export function postAfterText(hours) {
  if (hours === 0) return 'when the previous raid starts';
  const amount =
    hours % 24 === 0
      ? `${hours / 24} day${hours === 24 ? '' : 's'}`
      : `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${amount} after the previous raid starts`;
}

export function defaultSettings() {
  return {
    absenceChannelId: null,
    raiderRoleId: null,
    timeZone: null,
    reminderHours: DEFAULT_REMINDER_HOURS,
    memberDms: false,
  };
}

// Everything the raid features need for a server at `now` (Unix seconds):
//   { ...settings, timeZone, events, watched }
// timeZone is the time zone raid dates and times are read in: the setting, else raidReset's.
export function loadSetup(store, guildConfig, now) {
  const settings = store.getSettings(guildConfig.id) ?? defaultSettings();
  return {
    ...settings,
    timeZone: settings.timeZone ?? (guildConfig.raidReset ?? DEFAULT_RAID_RESET).timeZone,
    timeZoneSetting: settings.timeZone,
    events: store.raidEvents(guildConfig.id),
    watched: store.watchedChannels(guildConfig.id, now),
  };
}

// The roster role an event's members are expected to sign up from: its own, else the shared one.
export function eventRoleId(event, settings) {
  return event.raiderRoleId ?? settings.raiderRoleId ?? null;
}

// What is wrong with a proposed setup, as messages for the Officer who made the change; empty if
// nothing is. Checks the rules between events and settings; each field's own format is checked
// when it is read from the command.
//   guildConfig  for the @everyone (the guild ID) and join roles
export function setupProblems({ settings, events }, guildConfig) {
  const problems = [];
  if (events.length > MAX_EVENTS) {
    problems.push(`A server can have at most ${MAX_EVENTS} raid events.`);
  }

  const names = new Map();
  for (const event of events) {
    const key = event.name.toLowerCase();
    if (names.has(key)) problems.push(`There is already an event named "${names.get(key)}".`);
    names.set(key, event.name);
  }

  const roleProblem = (roleId) => {
    if (roleId === guildConfig.id) return 'is the @everyone role';
    if (roleId === guildConfig.joinRoleId) return 'is the role every new member gets';
    return null;
  };
  if (settings.raiderRoleId) {
    const problem = roleProblem(settings.raiderRoleId);
    if (problem) problems.push(`The shared roster role ${problem}, so it cannot be a roster.`);
  }

  // An event's roster is found by its channel, so a channel must map to one role.
  const channelRoles = new Map();
  for (const event of events) {
    const roleId = eventRoleId(event, settings);
    if (!roleId) {
      problems.push(
        `"${event.name}" has no roster role, and there is no shared roster role. Give it a role, ` +
          'or set a shared one in the raid settings.',
      );
      continue;
    }
    if (event.raiderRoleId) {
      const problem = roleProblem(event.raiderRoleId);
      if (problem) problems.push(`The roster role of "${event.name}" ${problem}.`);
    }
    const other = channelRoles.get(event.channelId);
    if (other && other.roleId !== roleId) {
      problems.push(
        `"${event.name}" and "${other.name}" are in the same channel but use different roster ` +
          'roles. Give each group its own channel, or use the same role.',
      );
    }
    channelRoles.set(event.channelId, { roleId, name: event.name });
  }

  // A weekly event is first seen when it is posted, and reminder points from before then are
  // skipped, so a reminder at or before the posting time would never be sent.
  for (const event of events) {
    if (!event.weekly) continue;
    const postHours = postLeadHours(event.weekly);
    const tooEarly = settings.reminderHours.filter((hours) => hours >= postHours);
    if (tooEarly.length) {
      problems.push(
        `"${event.name}" is posted ${postAfterText(event.weekly.postAfterHours)}, ` +
          `${postHours} hours before it starts, so the ${tooEarly.join(', ')}-hour ` +
          `reminder${tooEarly.length > 1 ? 's' : ''} would never be sent for it. Lower the ` +
          'reminder hours or post it earlier.',
      );
    }
  }
  return problems;
}
