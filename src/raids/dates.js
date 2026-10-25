import { formatIsoDate, isRealDate, localDate, parseIsoDate } from '../lib/time.js';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];
// A year without one is the next date that has not passed; Feb 29 may take a few years.
const YEARS_TO_TRY = 8;

const NUMERIC = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/;
// "Nov 4", "November 4th", "Wed Nov 4 2026" (any weekday is ignored).
const MONTH_FIRST = /^(?:[a-z]+\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/;
// "4 Nov", "4th of November 2026".
const DAY_FIRST = /^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)(?:\s+(\d{4}))?$/;

// Reads a date typed by a member as YYYY-MM-DD. Accepts 2026-11-04, 11/4 and 11/4/2026 (month
// first), and written-out months such as "Nov 4", "November 4th" or "4 November 2026". Without
// a year, it is the next such date on or after `onOrAfter` (a YYYY-MM-DD date, e.g. the start of
// a range), or else on or after today in `timeZone`. Returns null if the text is not a real date.
export function parseDateInput(text, timeZone, now = Date.now(), { onOrAfter } = {}) {
  const iso = parseIsoDate(text);
  if (iso) return iso;

  const normalized = text.trim().toLowerCase().replaceAll(/[.,]/g, ' ').replaceAll(/\s+/g, ' ');
  let month;
  let day;
  let year;

  let match = NUMERIC.exec(normalized);
  if (match) {
    [month, day, year] = [Number(match[1]), Number(match[2]), match[3] && Number(match[3])];
  } else if ((match = MONTH_FIRST.exec(normalized))) {
    [month, day, year] = [monthNumber(match[1]), Number(match[2]), match[3] && Number(match[3])];
  } else if ((match = DAY_FIRST.exec(normalized))) {
    [month, day, year] = [monthNumber(match[2]), Number(match[1]), match[3] && Number(match[3])];
  } else {
    return null;
  }
  if (!month) return null;

  if (year) return isRealDate(year, month, day) ? formatIsoDate(year, month, day) : null;

  const earliest = onOrAfter ?? todayIn(timeZone, now);
  const firstYear = Number(earliest.slice(0, 4));
  for (let candidate = firstYear; candidate < firstYear + YEARS_TO_TRY; candidate++) {
    if (!isRealDate(candidate, month, day)) continue;
    const date = formatIsoDate(candidate, month, day);
    if (date >= earliest) return date;
  }
  return null;
}

// 1-12 for a month name or an abbreviation of at least three letters ("sept" too), else null.
function monthNumber(word) {
  if (word.length < 3) return null;
  const index = MONTHS.findIndex((name) => name.startsWith(word));
  return index === -1 ? null : index + 1;
}

// Today's YYYY-MM-DD date in `timeZone`.
export function todayIn(timeZone, now = Date.now()) {
  return localDate(Math.floor(now / 1000), timeZone);
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

// "Wed Nov 4, 2026" for 2026-11-04.
export function formatDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return DATE_FORMAT.format(Date.UTC(year, month - 1, day)).replace(',', '');
}

// "Wed Nov 4, 2026", or "Wed Nov 4, 2026 – Fri Nov 6, 2026" for several days.
export function formatDateRange(startsOn, endsOn) {
  return startsOn === endsOn
    ? formatDate(startsOn)
    : `${formatDate(startsOn)} – ${formatDate(endsOn)}`;
}

// "19:30" for "19:30" or "7:30" style 24-hour input, else null.
export function parseTimeInput(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const [hour, minute] = [Number(match[1]), Number(match[2])];
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

// Time zone → formatter for formatTime().
const timeFormatters = new Map();

// "19:30" for `seconds` in `timeZone`.
export function formatTime(seconds, timeZone) {
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    timeFormatters.set(timeZone, formatter);
  }
  return formatter.format(seconds * 1000);
}
