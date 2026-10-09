import { discordTime } from './format.js';
import { DEFAULT_RAID_RESET, parseLocalDate, raidWeeksStart } from './raidWeeks.js';
import { AWARD_TYPES } from './store.js';

// Thrown for filter options that cannot be used together or do not parse. The message is shown
// to the user.
export class FilterError extends Error {
  name = 'FilterError';
}

// Reads the weeks / raid / from / to / type options of a loot query. Returns
// { filters: { since?, until?, raid?, type? }, description } where description reads like
// " in Molten Core in the last 2 raid weeks (since …)".
export function readFilters(options, guildConfig, now = Date.now()) {
  const reset = guildConfig.raidReset ?? DEFAULT_RAID_RESET;
  const weeks = options.getInteger('weeks');
  const from = options.getString('from');
  const to = options.getString('to');
  const raid = options.getString('raid');
  const type = options.getString('type');

  const filters = {};
  const parts = [];

  if (raid) {
    filters.raid = raid;
    parts.push(`in **${raid}**`);
  }

  if (weeks !== null && (from !== null || to !== null)) {
    throw new FilterError('Use either `weeks` or `from`/`to`, not both.');
  }
  if (weeks !== null) {
    filters.since = raidWeeksStart(weeks, reset, now);
    const span = weeks === 1 ? 'this raid week' : `the last ${weeks} raid weeks`;
    parts.push(`in ${span} (since ${discordTime(filters.since, 'f')})`);
  }
  if (from !== null) {
    filters.since = parseDate(from, reset.timeZone, 0, 'from');
  }
  if (to !== null) {
    // `to` includes the whole day.
    filters.until = parseDate(to, reset.timeZone, 1, 'to');
  }
  if (
    filters.since !== undefined &&
    filters.until !== undefined &&
    filters.since >= filters.until
  ) {
    throw new FilterError('`from` must be on or before `to`.');
  }
  if (from !== null && to !== null) parts.push(`from ${from} to ${to}`);
  else if (from !== null) parts.push(`since ${from}`);
  else if (to !== null) parts.push(`up to ${to}`);

  if (type) {
    filters.type = type;
    parts.push(`(${AWARD_TYPES[type].label.toLowerCase()} only)`);
  }

  return { filters, description: parts.length > 0 ? ` ${parts.join(' ')}` : '' };
}

function parseDate(text, timeZone, addDays, optionName) {
  const seconds = parseLocalDate(text, timeZone, addDays);
  if (seconds === null) {
    throw new FilterError(`\`${optionName}\` must be a date like 2026-11-04.`);
  }
  return seconds;
}
