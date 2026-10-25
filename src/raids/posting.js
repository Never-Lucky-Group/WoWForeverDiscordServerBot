import { localDate } from '../lib/time.js';

// Posts in progress, by `${guildId}:${raid event ID}:${date}`, so the weekly schedule and /raid
// create (or two Officers) cannot post the same event at once.
const inFlight = new Map();

// Posts a raid event on a date through Raid-Helper, unless an event for it already exists.
// An existing event is one in the same channel on the same local date with the same title (any
// case); this catches posts whose response was lost (e.g. a timeout after Raid-Helper created the
// event) and events posted with the same title by hand. The result is recorded so the weekly
// schedule does not post it again.
//   existingEvents        the guild's known upcoming events, from listEvents()
//   postedBy              the Discord user ID for /raid create, or null for the weekly schedule
//   title, description    optional, from /raid create: replace the config ones for this post
// Returns { event, created }.
export async function postConfiguredEvent(options) {
  const { guildId, eventConfig, startTime, timeZone } = options;
  const key = `${guildId}:${eventConfig.id}:${localDate(startTime, timeZone)}`;

  const pending = inFlight.get(key);
  if (pending) {
    try {
      const { event } = await pending;
      return { event, created: false };
    } catch {
      // The other attempt failed; try again below.
    }
  }

  const attempt = postOnce(options);
  inFlight.set(key, attempt);
  try {
    return await attempt;
  } finally {
    if (inFlight.get(key) === attempt) inFlight.delete(key);
  }
}

async function postOnce({
  api,
  store,
  guildId,
  apiKey,
  eventConfig,
  startTime,
  timeZone,
  existingEvents,
  postedBy = null,
  title: customTitle,
  description: customDescription,
  now,
}) {
  const date = localDate(startTime, timeZone);
  const title = customTitle ?? eventConfig.title ?? eventConfig.name;
  const description = customDescription ?? eventConfig.description;
  const existing = existingEvents.find(
    (event) =>
      event.channelId === eventConfig.channelId &&
      localDate(event.startTime, timeZone) === date &&
      event.title.toLowerCase() === title.toLowerCase(),
  );

  const event =
    existing ??
    (await api.createEvent(guildId, eventConfig.channelId, apiKey, {
      leaderId: eventConfig.leaderId,
      templateId: eventConfig.templateId,
      startTime,
      title,
      description: description && expandLineBreaks(description),
    }));
  // Raid-Helper may leave out the channel in its reply; the bot asked for this one.
  event.channelId ??= eventConfig.channelId;

  store.recordPostedEvent(
    guildId,
    {
      raidEventId: eventConfig.id,
      date,
      eventId: event.id,
      postedBy: existing ? null : postedBy,
    },
    now,
  );
  return { event, created: !existing };
}

// Slash command text cannot hold line breaks, so a typed \n stands for one.
export function expandLineBreaks(text) {
  return text.replaceAll('\\n', '\n');
}
