import { WEEKDAYS } from '../config.js';

// Used when a guild's config has no raidReset. WoW Forever's reset is not known yet; this is the
// usual US reset.
export const DEFAULT_RAID_RESET = { weekday: 'tuesday', time: '15:00', timeZone: 'UTC' };

const DAY_MS = 24 * 60 * 60 * 1000;

// Returns the start (Unix seconds) of the period covering the last `weeks` raid weeks: weeks = 1
// is the time since the most recent reset, weeks = 2 adds the raid week before it, and so on.
export function raidWeeksStart(weeks, reset = DEFAULT_RAID_RESET, now = Date.now()) {
  const local = zonedParts(now, reset.timeZone);
  const [resetHour, resetMinute] = reset.time.split(':').map(Number);
  const resetWeekday = WEEKDAYS.indexOf(reset.weekday);

  let daysBack = (local.weekday - resetWeekday + 7) % 7;
  if (daysBack === 0 && local.hour * 60 + local.minute < resetHour * 60 + resetMinute) {
    daysBack = 7;
  }
  daysBack += 7 * (weeks - 1);

  // Step back in calendar days (not 24-hour blocks) so a daylight saving change keeps the reset
  // at the same local time.
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day) - daysBack * DAY_MS);
  return Math.floor(
    zonedTimeToUtc(
      {
        year: day.getUTCFullYear(),
        month: day.getUTCMonth() + 1,
        day: day.getUTCDate(),
        hour: resetHour,
        minute: resetMinute,
      },
      reset.timeZone,
    ) / 1000,
  );
}

// Parses a YYYY-MM-DD date as the start of that day in `timeZone`, or of the day `addDays` later.
// Returns Unix seconds, or null if the text is not a real date.
export function parseLocalDate(text, timeZone, addDays = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const target = new Date(check.getTime() + addDays * DAY_MS);
  return Math.floor(
    zonedTimeToUtc(
      {
        year: target.getUTCFullYear(),
        month: target.getUTCMonth() + 1,
        day: target.getUTCDate(),
        hour: 0,
        minute: 0,
      },
      timeZone,
    ) / 1000,
  );
}

// The YYYY-MM-DD date at `seconds` in `timeZone`.
export function localDate(seconds, timeZone) {
  const { year, month, day } = zonedParts(seconds * 1000, timeZone);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// The calendar date and time at `timestamp` (ms) in `timeZone`.
function zonedParts(timestamp, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    })
      .formatToParts(new Date(timestamp))
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  };
}

// How far ahead of UTC `timeZone` is at `timestamp` (ms), in ms.
function zoneOffset(timestamp, timeZone) {
  const local = zonedParts(timestamp, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - (timestamp - (timestamp % 1000));
}

// The instant (ms) at which the wall clock in `timeZone` shows the given local time.
function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wallClock - zoneOffset(wallClock, timeZone);
  // The offset at the guess can differ from the offset at the wall-clock time near a daylight
  // saving change; one correction settles it.
  return wallClock - zoneOffset(guess, timeZone);
}
