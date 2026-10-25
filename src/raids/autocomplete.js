import { truncate } from '../lib/text.js';
import { localDate } from '../lib/time.js';
import { formatDate, formatTime, parseDateInput, todayIn } from './dates.js';
import { LOOKAHEAD_SECONDS } from './scheduler.js';
import { weeklyOccurrences } from './schedule.js';

export const AUTOCOMPLETE_LIMIT = 25;
const CHOICE_NAME_LIMIT = 100;

// Date suggestions for a date option, as Discord choices whose value is YYYY-MM-DD:
//   1. what the member typed, if it reads as a date, spelled out so they can check it;
//   2. upcoming event dates such as "Wed Nov 4, 2026 – Molten Core", from the events the
//      background loop last fetched and the weekly schedule.
// Never calls Raid-Helper: Discord allows only 3 seconds to answer.
//   eventConfigs  the configured events whose weekly dates to offer
//   minDate       only offer dates from this YYYY-MM-DD date on (e.g. `to` after `from`)
export function dateChoices({ text, timeZone, now, events, eventConfigs, minDate = null }) {
  const today = todayIn(timeZone, now);
  const earliest = minDate && minDate > today ? minDate : today;
  const typed = text.trim();
  // Read the same way as the command reads it: without a year, on or after minDate.
  const parsed = typed
    ? parseDateInput(typed, timeZone, now, { onOrAfter: minDate ?? undefined })
    : null;

  const choices = [];
  if (parsed && parsed >= earliest) choices.push({ name: formatDate(parsed), value: parsed });

  const raidDates = new Map();
  const add = (date, title) => {
    const name = choiceName(`${formatDate(date)} – ${title}`);
    raidDates.set(name.toLowerCase(), { name, value: date });
  };
  for (const event of events) add(localDate(event.startTime, timeZone), event.title);
  const nowSeconds = Math.floor(now / 1000);
  for (const eventConfig of eventConfigs) {
    if (!eventConfig.weekly) continue;
    for (const start of weeklyOccurrences(
      eventConfig.weekly,
      timeZone,
      nowSeconds,
      nowSeconds + LOOKAHEAD_SECONDS,
    )) {
      add(localDate(start, timeZone), eventConfig.title ?? eventConfig.name);
    }
  }

  const lowerText = typed.toLowerCase();
  const suggestions = [...raidDates.values()]
    .filter(({ value }) => value >= earliest)
    .filter(({ name, value }) =>
      parsed ? value === parsed : name.toLowerCase().includes(lowerText),
    )
    .sort((a, b) => a.value.localeCompare(b.value) || a.name.localeCompare(b.name));
  return [...choices, ...suggestions].slice(0, AUTOCOMPLETE_LIMIT);
}

// Upcoming events as choices whose value is the event ID, e.g. "Wed Nov 4, 2026 19:30 – Molten
// Core".
export function eventChoices({ text, timeZone, events }) {
  const lowerText = text.trim().toLowerCase();
  return events
    .map((event) => ({
      name: choiceName(
        `${formatDate(localDate(event.startTime, timeZone))} ` +
          `${formatTime(event.startTime, timeZone)} – ${event.title}`,
      ),
      value: event.id,
    }))
    .filter(({ name, value }) => name.toLowerCase().includes(lowerText) || value === text.trim())
    .slice(0, AUTOCOMPLETE_LIMIT);
}

// Autocomplete choice names are limited to 100 characters.
export function choiceName(text) {
  return truncate(text, CHOICE_NAME_LIMIT);
}
