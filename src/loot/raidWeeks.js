import { WEEKDAYS } from '../config.js';
import { zonedParts, zonedTimeToUtc } from '../lib/time.js';

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
