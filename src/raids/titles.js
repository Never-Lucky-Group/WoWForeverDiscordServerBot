import { weekdayOfDate } from '../lib/time.js';

// An event's title may hold placeholders that are filled in with the raid's date when it is
// posted, so each week's sheet has its own title: "Molten Core {date}" → "Molten Core 11/4".

// Raid-Helper's title limit, in characters.
export const TITLE_LIMIT = 100;
export const TITLE_HELP =
  '{date} becomes the raid date, e.g. 11/4, and {day} its weekday, e.g. Tue';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLACEHOLDERS = {
  date: (date) => {
    const [, month, day] = date.split('-').map(Number);
    return `${month}/${day}`;
  },
  day: (date) => DAY_NAMES[weekdayOfDate(date)],
};
// The longest each placeholder can become, for the length check.
const LONGEST = { date: '12/31', day: 'Wed' };
const PLACEHOLDER = /\{([^{}]*)\}/g;

// `title` for the raid on `date` (YYYY-MM-DD), its placeholders filled in. Unknown ones, which
// only /raid create can give, stay as typed.
export function fillTitle(title, date) {
  return title.replace(PLACEHOLDER, (text, name) => {
    const fill = PLACEHOLDERS[name.trim().toLowerCase()];
    return fill ? fill(date) : text;
  });
}

// What is wrong with an event's title, as a message for the Officer, or null: an unknown
// placeholder, or too long once filled in.
export function titleProblem(title) {
  const unknown = [...title.matchAll(PLACEHOLDER)]
    .map(([text, name]) => ({ text, name: name.trim().toLowerCase() }))
    .find(({ name }) => !PLACEHOLDERS[name]);
  if (unknown) {
    return `The title has ${unknown.text}, which the bot does not know. ${capitalize(TITLE_HELP)}.`;
  }
  const longest = title.replace(PLACEHOLDER, (_, name) => LONGEST[name.trim().toLowerCase()]);
  if (longest.length > TITLE_LIMIT) {
    return `The title can be up to ${TITLE_LIMIT} characters once the date is filled in.`;
  }
  return null;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
