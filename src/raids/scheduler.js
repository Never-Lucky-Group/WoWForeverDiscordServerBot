import { escapeMarkdown } from 'discord.js';
import { logger } from '../lib/logger.js';
import { localDate } from '../lib/time.js';
import { RaidHelperError } from './apiClient.js';
import { formatDate } from './dates.js';
import { raidersOf, sortRaiders } from './missing.js';
import { postConfiguredEvent } from './posting.js';
import { nextReport, reminderReason, reportEmbed } from './report.js';
import { dmMissingMembers } from './rsvp.js';
import { duePoint, duePosts, raidChannelIds, reminderPoints, rosterRoleId } from './schedule.js';
import { loadSetup } from './setup.js';

export const TICK_MS = 10 * 60 * 1000;
// How often a weekly post that keeps failing is logged as an error and reported to its leader.
export const POST_FAILURE_NOTICE_SECONDS = 24 * 60 * 60;
// How far ahead events are fetched. Reminders only need the next few days; autocomplete offers
// upcoming events from this whole window.
export const LOOKAHEAD_SECONDS = 28 * 24 * 60 * 60;

// The background loop. Every TICK_MS, for each allowlisted server with a Raid-Helper API key and
// raid events set up, it:
//   1. fetches the upcoming events in the raid channels, with their sign-ups;
//   2. posts the weekly events that are due;
//   3. sends the event leader a missing sign-ups report at each reminder point (and DMs the
//      missing members, if memberDms is on).
// A failure in one server is logged and does not stop the others.
export class RaidScheduler {
  #timer = null;
  #running = null;
  // Set by refresh() during a run, which may have read the raid setup before the change.
  #rerun = false;
  #stopped = false;
  // Guild ID → upcoming events from the last successful fetch, soonest first.
  #upcoming = new Map();
  // Guild IDs whose last fetch failed, so a lasting failure is logged once rather than every tick.
  #failing = new Set();
  // `${guildId}:${raid event ID}` → when a failing weekly post was last reported (Unix seconds).
  #postFailures = new Map();

  constructor({ client, store, api, apiKeys, now = () => Date.now() }) {
    this.client = client;
    this.store = store;
    this.api = api;
    this.apiKeys = apiKeys;
    this.now = now;
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => void this.tick(), TICK_MS);
    void this.tick();
  }

  // Stops the loop and waits up to `timeoutMs` for a run in progress to finish. Returns whether
  // it finished (or none was running).
  async stop(timeoutMs = Infinity) {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#stopped = true;
    if (!this.#running) return true;
    let timer;
    const timedOut = new Promise((resolve) => {
      if (Number.isFinite(timeoutMs)) timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([this.#running.then(() => true), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }

  // Adds an event posted outside a run (by /raid create) to the upcoming events, so autocomplete
  // offers it before the next run.
  addUpcomingEvent(guildId, event) {
    const events = (this.#upcoming.get(guildId) ?? []).filter(
      (existing) => existing.id !== event.id,
    );
    events.push(event);
    events.sort((a, b) => a.startTime - b.startTime);
    this.#upcoming.set(guildId, events);
  }

  // Upcoming events in the server's configured channels, soonest first, as of the last successful
  // fetch. Events that have started since are left out.
  upcomingEvents(guildId) {
    const now = this.#nowSeconds();
    return (this.#upcoming.get(guildId) ?? []).filter((event) => event.startTime > now);
  }

  // Runs once over every server. A run still in progress is not started twice.
  tick() {
    this.#running ??= this.#runAll().finally(() => {
      this.#running = null;
      if (this.#rerun && !this.#stopped) {
        this.#rerun = false;
        void this.tick();
      }
    });
    return this.#running;
  }

  // Runs again soon after the raid setup changed, rather than at the next tick: now, or right
  // after the run in progress. New events then show up in autocomplete, and a new weekly time is
  // posted, straight away.
  refresh() {
    if (this.#stopped) return;
    if (this.#running) this.#rerun = true;
    else void this.tick();
  }

  async #runAll() {
    for (const guildConfig of this.client.botConfig.guilds.values()) {
      const apiKey = this.apiKeys.get(guildConfig.id);
      const guild = this.client.guilds.cache.get(guildConfig.id);
      if (!apiKey || !guild) continue;
      try {
        const setup = loadSetup(this.store, guildConfig, this.#nowSeconds());
        if (setup.events.length === 0 && setup.watched.length === 0) continue;
        await this.#runGuild(guild, setup, apiKey);
      } catch (error) {
        logger.error({ guildId: guild.id, err: error }, 'Raid-Helper run failed for a server');
      }
    }
    try {
      this.store.cleanup(this.#nowSeconds());
    } catch (error) {
      logger.error({ err: error }, 'Failed to clean up old raid data');
    }
  }

  async #runGuild(guild, setup, apiKey) {
    const now = this.#nowSeconds();
    const events = await this.#fetchEvents(guild, setup, apiKey, now);
    if (!events) return;

    await this.#postWeekly(guild, setup, apiKey, events, now);
    events.sort((a, b) => a.startTime - b.startTime);
    this.#upcoming.set(guild.id, events);

    const firstSeen = this.store.markSeen(guild.id, events, now);
    for (const event of events) {
      try {
        await this.#remind(guild, setup, event, firstSeen.get(event.id), now);
      } catch (error) {
        logger.error(
          { guildId: guild.id, eventId: event.id, err: error },
          'Failed to check an event for missing sign-ups',
        );
      }
    }
  }

  // Upcoming events in the raid channels, or null if Raid-Helper could not be reached.
  async #fetchEvents(guild, setup, apiKey, now) {
    const channelIds = raidChannelIds(setup);
    let events;
    try {
      events = await this.api.listEvents(guild.id, apiKey, {
        startTime: now,
        endTime: now + LOOKAHEAD_SECONDS,
      });
    } catch (error) {
      const logInfo = { guildId: guild.id, err: error };
      if (this.#failing.has(guild.id)) {
        logger.debug(logInfo, 'Raid-Helper is still failing');
      } else {
        this.#failing.add(guild.id);
        logger.error(logInfo, failureMessage(error));
      }
      return null;
    }
    if (this.#failing.delete(guild.id)) {
      logger.info({ guildId: guild.id }, 'Raid-Helper requests work again');
    }
    return events.filter((event) => channelIds.has(event.channelId) && event.startTime > now);
  }

  // Posts the weekly events that are due, adding new ones to `events`.
  async #postWeekly(guild, setup, apiKey, events, now) {
    const { timeZone } = setup;
    for (const eventConfig of setup.events) {
      for (const { date, startTime } of duePosts(eventConfig, timeZone, now)) {
        if (this.store.findPostedEvent(guild.id, eventConfig.id, date)) continue;
        const logInfo = { guildId: guild.id, eventName: eventConfig.name, date };
        try {
          const { event, created } = await postConfiguredEvent({
            api: this.api,
            store: this.store,
            guildId: guild.id,
            apiKey,
            eventConfig,
            startTime,
            timeZone,
            existingEvents: events,
            now,
          });
          this.#postWorked(guild, eventConfig, logInfo);
          if (created) {
            events.push(event);
            logger.info({ ...logInfo, eventId: event.id }, 'Posted a weekly Raid-Helper event');
          } else {
            logger.info(
              { ...logInfo, eventId: event.id },
              'A weekly Raid-Helper event was already posted; not posting it again',
            );
          }
        } catch (error) {
          // Tried again next run. If Raid-Helper did create it, the next run finds it.
          await this.#postFailed(guild, eventConfig, date, error, logInfo, now);
        }
      }
    }
  }

  // A weekly post that keeps failing (say, a mistyped template) is logged as an error and DMed to
  // the event's leader once a day, so Officers find out without the log filling up every run.
  async #postFailed(guild, eventConfig, date, error, logInfo, now) {
    const key = `${guild.id}:${eventConfig.id}`;
    const last = this.#postFailures.get(key);
    if (last !== undefined && now - last < POST_FAILURE_NOTICE_SECONDS) {
      logger.debug({ ...logInfo, err: error }, 'A weekly Raid-Helper event still cannot be posted');
      return;
    }
    this.#postFailures.set(key, now);
    logger.error({ ...logInfo, err: error }, 'Failed to post a weekly Raid-Helper event');
    const reason =
      error instanceof RaidHelperError
        ? `Raid-Helper said: ${error.message}`
        : 'Something went wrong (see the bot logs).';
    try {
      const leader = await this.client.users.fetch(eventConfig.leaderId);
      await leader.send({
        content:
          `**${escapeMarkdown(guild.name)}**: the weekly **${escapeMarkdown(eventConfig.name)}** ` +
          `sign-up sheet for ${formatDate(date)} could not be posted in <#${eventConfig.channelId}>. ` +
          `${reason}\n\nThe bot tries again every 10 minutes, and tells you again tomorrow if it ` +
          'still fails. An Officer can check the event with `/raidsetup panel`, for example ' +
          'that its template ID is right.',
        allowedMentions: { parse: [] },
      });
    } catch (dmError) {
      logger.warn(
        { ...logInfo, leaderId: eventConfig.leaderId, err: dmError },
        'Could not DM the event leader that a weekly post failed',
      );
    }
  }

  #postWorked(guild, eventConfig, logInfo) {
    if (this.#postFailures.delete(`${guild.id}:${eventConfig.id}`)) {
      logger.info(logInfo, 'A weekly Raid-Helper event can be posted again');
    }
  }

  async #remind(guild, setup, event, firstSeenAt, now) {
    const points = reminderPoints(event, setup.reminderHours);
    const point = duePoint(points, {
      now,
      firstSeenAt,
      startTime: event.startTime,
      sent: this.store.sentReminderPoints(guild.id, event.id, event.startTime),
    });
    if (!point) return;
    // Marked first, so a failure below cannot repeat the report or the DMs every run.
    this.store.markReminderSent(guild.id, event.id, event.startTime, point.key, now);

    const date = localDate(event.startTime, setup.timeZone);
    const roleId = rosterRoleId(setup, event.channelId);
    const raiders = raidersOf(guild, roleId);
    const sorted = sortRaiders(raiders, event, this.store.absentUserIds(guild.id, date));
    const logInfo = { guildId: guild.id, eventId: event.id, point: point.key };
    // A sign-up despite an absence is reported too, so the leader can check which is right.
    if (sorted.missing.length === 0 && sorted.conflicts.length === 0) {
      logger.debug(logInfo, 'No missing sign-ups to report');
      return;
    }

    const dms = setup.memberDms
      ? await dmMissingMembers({
          store: this.store,
          guild,
          event,
          members: sorted.missing,
          now,
        })
      : undefined;
    const report = {
      roleId,
      rosterSize: raiders.length,
      sorted,
      reason: reminderReason(point),
      next: nextReport(points, point),
      checkedAt: now * 1000,
      dms,
    };
    await this.#sendReport(guild, event, report, logInfo);
  }

  // `report` holds reportEmbed()'s options other than guild and event.
  async #sendReport(guild, event, report, logInfo) {
    if (!event.leaderId) {
      logger.warn(logInfo, 'Raid-Helper event has no leader; missing sign-ups report not sent');
      return;
    }
    try {
      const leader = await this.client.users.fetch(event.leaderId);
      await leader.send({ embeds: [reportEmbed({ guild, event, forLeader: true, ...report })] });
      logger.info(
        { ...logInfo, leaderId: event.leaderId, missing: report.sorted.missing.length },
        'Sent a missing sign-ups report',
      );
    } catch (error) {
      logger.warn(
        { ...logInfo, leaderId: event.leaderId, err: error },
        'Could not DM the event leader the missing sign-ups report',
      );
    }
  }

  #nowSeconds() {
    return Math.floor(this.now() / 1000);
  }
}

function failureMessage(error) {
  if (error instanceof RaidHelperError && (error.status === 401 || error.status === 403)) {
    return 'Raid-Helper rejected the API key; check RAID_HELPER_API_KEYS (run /apikey again)';
  }
  return 'Could not fetch Raid-Helper events; retrying every run';
}
