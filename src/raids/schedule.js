import { WEEKDAYS } from '../config.js';
import { addDaysToDate, localDate, localTimeToSeconds, weekdayOfDate } from '../lib/time.js';

const DAY_SECONDS = 24 * 60 * 60;
const HOUR_SECONDS = 60 * 60;

// Start times (Unix seconds) of a weekly event between fromSeconds and toSeconds, inclusive.
export function weeklyOccurrences(weekly, timeZone, fromSeconds, toSeconds) {
  const weekday = WEEKDAYS.indexOf(weekly.weekday);
  const lastDate = addDaysToDate(localDate(toSeconds, timeZone), 1);
  const starts = [];
  for (
    let date = addDaysToDate(localDate(fromSeconds, timeZone), -1);
    date <= lastDate;
    date = addDaysToDate(date, 1)
  ) {
    if (weekdayOfDate(date) !== weekday) continue;
    const start = localTimeToSeconds(date, weekly.time, timeZone);
    if (start >= fromSeconds && start <= toSeconds) starts.push(start);
  }
  return starts;
}

// Occurrences of a configured weekly event that are due to be posted at `now`: those that have
// not started yet and whose posting time has come. Returns [{ date, startTime }].
export function duePosts(eventConfig, timeZone, now) {
  const { weekly } = eventConfig;
  if (!weekly) return [];
  // A sheet is posted at most a week ahead; the extra day covers a daylight saving change.
  return weeklyOccurrences(weekly, timeZone, now + 1, now + 8 * DAY_SECONDS)
    .map((startTime) => ({ date: localDate(startTime, timeZone), startTime }))
    .filter(({ date }) => postTime(weekly, date, timeZone) <= now);
}

// When the sheet for the weekly event on `date` is posted: postAfterHours after the raid's start
// time a week earlier, on the clock of the raid time zone.
export function postTime(weekly, date, timeZone) {
  const previousStart = localTimeToSeconds(addDaysToDate(date, -7), weekly.time, timeZone);
  return previousStart + weekly.postAfterHours * HOUR_SECONDS;
}

// The times at which an event's leader gets a missing sign-ups report, earliest first:
// [{ key, at, hours }] with key '48h' etc., plus { key: 'close', at } when Raid-Helper closes
// sign-ups before the event starts.
export function reminderPoints(event, reminderHours) {
  const points = reminderHours.map((hours) => ({
    key: `${hours}h`,
    at: event.startTime - hours * HOUR_SECONDS,
    hours,
  }));
  if (event.closeTime !== null && event.closeTime < event.startTime) {
    points.push({ key: 'close', at: event.closeTime });
  }
  return points.sort((a, b) => a.at - b.at);
}

// The reminder point to report at `now`, or null. Points that passed before the bot first saw
// the event are skipped. Of the points that passed since, only the latest counts, so a bot that
// was offline sends one report rather than a burst. Nothing is due once the event has started.
export function duePoint(points, { now, firstSeenAt, startTime, sent }) {
  if (now >= startTime) return null;
  const latest = points.filter((point) => point.at <= now && point.at >= firstSeenAt).at(-1);
  return latest && !sent.has(latest.key) ? latest : null;
}

// The channels whose events the bot checks: those of the server's raid events, and those still
// watched after their event was removed or moved.
export function raidChannelIds(setup) {
  return new Set([
    ...setup.events.map((event) => event.channelId),
    ...setup.watched.map((watched) => watched.channelId),
  ]);
}

// Whether a Raid-Helper event is in one of the server's raid channels. Raid-Helper serves any
// event without a key, so events fetched by ID are checked with this. Channel IDs are unique
// across Discord, so the channel alone ties the event to the server; serverId is compared too when
// Raid-Helper includes it.
export function isConfiguredEvent(event, setup, guildId) {
  return (
    raidChannelIds(setup).has(event.channelId) &&
    (event.serverId === null || event.serverId === guildId)
  );
}

// The role whose members are expected to sign up for events in a channel: the raiderRoleId of the
// channel's event, else of the removed event still watched there, else the shared one. /raidsetup
// keeps one role per channel among events.
export function rosterRoleId(setup, channelId) {
  const owner =
    setup.events.find((event) => event.channelId === channelId) ??
    setup.watched.find((watched) => watched.channelId === channelId);
  return owner?.raiderRoleId ?? setup.raiderRoleId;
}

// Every roster role in a server: the shared one, each event's and each watched channel's.
export function rosterRoleIds(setup) {
  return new Set(
    [
      setup.raiderRoleId,
      ...[...setup.events, ...setup.watched].map((item) => item.raiderRoleId),
    ].filter(Boolean),
  );
}

// Link to the event's message in Discord. The Raid-Helper event ID is the message ID.
export function eventUrl(guildId, event) {
  return `https://discord.com/channels/${guildId}/${event.channelId}/${event.id}`;
}
