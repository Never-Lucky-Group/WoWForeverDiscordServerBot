// Time zone helpers shared by the loot and raid features. Dates are YYYY-MM-DD strings and times
// are Unix seconds unless noted otherwise.

const DAY_MS = 24 * 60 * 60 * 1000;

// Parses a YYYY-MM-DD date as the start of that day in `timeZone`, or of the day `addDays` later.
// Returns Unix seconds, or null if the text is not a real date.
export function parseLocalDate(text, timeZone, addDays = 0) {
  const date = parseIsoDate(text);
  if (!date) return null;
  return localTimeToSeconds(addDaysToDate(date, addDays), '00:00', timeZone);
}

// The YYYY-MM-DD date at `seconds` in `timeZone`.
export function localDate(seconds, timeZone) {
  const { year, month, day } = zonedParts(seconds * 1000, timeZone);
  return formatIsoDate(year, month, day);
}

// The Unix seconds at which the wall clock in `timeZone` shows `time` (HH:MM) on `date`.
export function localTimeToSeconds(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return Math.floor(zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) / 1000);
}

// The YYYY-MM-DD date `days` calendar days after `date` (negative goes back).
export function addDaysToDate(date, days) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return formatIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

// Day of the week of a YYYY-MM-DD date: 0 = Sunday ... 6 = Saturday.
export function weekdayOfDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

// `text` as a YYYY-MM-DD date without surrounding spaces if it is a real date, otherwise null.
export function parseIsoDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  return isRealDate(year, month, day) ? formatIsoDate(year, month, day) : null;
}

export function isRealDate(year, month, day) {
  const check = new Date(Date.UTC(year, month - 1, day));
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

// Whether `value` is an IANA time zone such as "Europe/London" that this Node.js knows.
export function isTimeZone(value) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function formatIsoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Time zone → formatter for zonedParts(). Creating a formatter is slow compared to using one, and
// autocomplete converts many times per keystroke.
const partsFormatters = new Map();

function partsFormatter(timeZone) {
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsFormatters.set(timeZone, formatter);
  }
  return formatter;
}

// The calendar date and time at `timestamp` (ms) in `timeZone`.
export function zonedParts(timestamp, timeZone) {
  const parts = Object.fromEntries(
    partsFormatter(timeZone)
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
export function zonedTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wallClock - zoneOffset(wallClock, timeZone);
  // The offset at the guess can differ from the offset at the wall-clock time near a daylight
  // saving change; one correction settles it.
  return wallClock - zoneOffset(guess, timeZone);
}
