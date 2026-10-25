// All reads and writes of raid data. Every method is scoped to one Discord guild. Times are Unix
// seconds; dates are YYYY-MM-DD in the server's raid time zone.

const ABSENCE_COLUMNS = `
  id, user_id AS userId, starts_on AS startsOn, ends_on AS endsOn, reason,
  created_by AS createdBy, created_at AS createdAt, source`;

const RAID_EVENT_COLUMNS = `
  id, name, channel_id AS channelId, template_id AS templateId, leader_id AS leaderId,
  raider_role_id AS raiderRoleId, title, description, weekday, time,
  post_after_hours AS postAfterHours`;

// Rows about events that ended this long ago are deleted by cleanup().
export const RETENTION_SECONDS = 30 * 24 * 60 * 60;

// NULL columns become missing fields, as the rest of the bot expects of optional ones.
function raidEventFromRow({ weekday, time, postAfterHours, ...row }) {
  const event = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null) event[key] = value;
  }
  if (weekday) event.weekly = { weekday, time, postAfterHours };
  return event;
}

// A raid event's column values, in the order addRaidEvent() and updateRaidEvent() list them.
function raidEventValues(event) {
  return [
    event.name,
    event.channelId,
    event.templateId,
    event.leaderId,
    event.raiderRoleId ?? null,
    event.title ?? null,
    event.description ?? null,
    event.weekly?.weekday ?? null,
    event.weekly?.time ?? null,
    event.weekly?.postAfterHours ?? null,
  ];
}

export class RaidStore {
  constructor(db) {
    this.db = db;
  }

  // Stores an absence and returns it with its number.
  addAbsence(guildId, { userId, startsOn, endsOn, reason = null, createdBy, source }, now) {
    const { id } = this.db
      .prepare(
        `INSERT INTO absences (guild_id, user_id, starts_on, ends_on, reason, created_by,
           created_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(guildId, userId, startsOn, endsOn, reason, createdBy, now, source);
    return this.getAbsence(guildId, id);
  }

  getAbsence(guildId, id) {
    return (
      this.db
        .prepare(`SELECT ${ABSENCE_COLUMNS} FROM absences WHERE guild_id = ? AND id = ?`)
        .get(guildId, id) ?? null
    );
  }

  // Absences that have not ended before `today`, soonest first. Only `userId`'s if given.
  upcomingAbsences(guildId, today, userId = null) {
    return this.db
      .prepare(
        `SELECT ${ABSENCE_COLUMNS} FROM absences
         WHERE guild_id = ? AND ends_on >= ? AND (? IS NULL OR user_id = ?)
         ORDER BY starts_on, ends_on, id`,
      )
      .all(guildId, today, userId, userId);
  }

  // Whether an absence was deleted.
  deleteAbsence(guildId, id) {
    return (
      this.db.prepare('DELETE FROM absences WHERE guild_id = ? AND id = ?').run(guildId, id)
        .changes > 0
    );
  }

  // IDs of members with an absence covering `date`.
  absentUserIds(guildId, date) {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT user_id AS userId FROM absences
         WHERE guild_id = ? AND starts_on <= ? AND ends_on >= ?`,
      )
      .all(guildId, date, date);
    return new Set(rows.map((row) => row.userId));
  }

  // The server's raid settings as stored, or null if none were ever saved:
  //   { absenceChannelId, raiderRoleId, timeZone, reminderHours, memberDms }
  // with null for each unset ID or time zone.
  getSettings(guildId) {
    const row = this.db
      .prepare(
        `SELECT absence_channel_id AS absenceChannelId, raider_role_id AS raiderRoleId,
           time_zone AS timeZone, reminder_hours AS reminderHours, member_dms AS memberDms
         FROM raid_settings WHERE guild_id = ?`,
      )
      .get(guildId);
    if (!row) return null;
    return { ...row, reminderHours: JSON.parse(row.reminderHours), memberDms: row.memberDms === 1 };
  }

  saveSettings(guildId, settings, updatedBy, now) {
    this.db
      .prepare(
        `INSERT INTO raid_settings (guild_id, absence_channel_id, raider_role_id, time_zone,
           reminder_hours, member_dms, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET
           absence_channel_id = excluded.absence_channel_id,
           raider_role_id = excluded.raider_role_id,
           time_zone = excluded.time_zone,
           reminder_hours = excluded.reminder_hours,
           member_dms = excluded.member_dms,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .run(
        guildId,
        settings.absenceChannelId ?? null,
        settings.raiderRoleId ?? null,
        settings.timeZone ?? null,
        JSON.stringify(settings.reminderHours),
        settings.memberDms ? 1 : 0,
        updatedBy,
        now,
      );
  }

  // The server's raid events, by name:
  //   { id, name, channelId, templateId, leaderId, raiderRoleId?, title?, description?, weekly? }
  // weekly is { weekday, time, postAfterHours } when the event is posted every week.
  raidEvents(guildId) {
    return this.db
      .prepare(
        `SELECT ${RAID_EVENT_COLUMNS} FROM raid_events WHERE guild_id = ?
         ORDER BY name COLLATE NOCASE, id`,
      )
      .all(guildId)
      .map(raidEventFromRow);
  }

  // Adds a raid event (shaped as raidEvents() returns them, without id) and returns its ID.
  addRaidEvent(guildId, event, createdBy, now) {
    const { id } = this.db
      .prepare(
        `INSERT INTO raid_events (guild_id, name, channel_id, template_id, leader_id,
           raider_role_id, title, description, weekday, time, post_after_hours, created_by,
           created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get(guildId, ...raidEventValues(event), createdBy, now, createdBy, now);
    return id;
  }

  // Replaces a raid event's fields.
  updateRaidEvent(guildId, event, updatedBy, now) {
    this.db
      .prepare(
        `UPDATE raid_events SET name = ?, channel_id = ?, template_id = ?, leader_id = ?,
           raider_role_id = ?, title = ?, description = ?, weekday = ?, time = ?,
           post_after_hours = ?, updated_by = ?, updated_at = ?
         WHERE guild_id = ? AND id = ?`,
      )
      .run(...raidEventValues(event), updatedBy, now, guildId, event.id);
  }

  deleteRaidEvent(guildId, id) {
    this.db.prepare('DELETE FROM raid_events WHERE guild_id = ? AND id = ?').run(guildId, id);
  }

  // Keeps checking `channelId` until `watchUntil`, for an event that was removed or moved. A
  // channel already watched keeps the later time.
  watchChannel(guildId, { channelId, raiderRoleId = null, eventName, watchUntil }) {
    this.db
      .prepare(
        `INSERT INTO watched_channels (guild_id, channel_id, raider_role_id, event_name,
           watch_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, channel_id) DO UPDATE SET
           raider_role_id = excluded.raider_role_id,
           event_name = excluded.event_name,
           watch_until = excluded.watch_until
         WHERE excluded.watch_until > watched_channels.watch_until`,
      )
      .run(guildId, channelId, raiderRoleId, eventName, watchUntil);
  }

  // Channels still watched at `now`: [{ channelId, raiderRoleId?, eventName, watchUntil }].
  watchedChannels(guildId, now) {
    return this.db
      .prepare(
        `SELECT channel_id AS channelId, raider_role_id AS raiderRoleId, event_name AS eventName,
           watch_until AS watchUntil
         FROM watched_channels WHERE guild_id = ? AND watch_until > ? ORDER BY channel_id`,
      )
      .all(guildId, now)
      .map((row) => ({ ...row, raiderRoleId: row.raiderRoleId ?? undefined }));
  }

  // The event posted for a raid event on `date`, or null.
  findPostedEvent(guildId, raidEventId, date) {
    return (
      this.db
        .prepare(
          `SELECT event_id AS eventId, posted_by AS postedBy, posted_at AS postedAt
           FROM posted_events WHERE guild_id = ? AND raid_event_id = ? AND event_date = ?`,
        )
        .get(guildId, raidEventId, date) ?? null
    );
  }

  // Dates on or after `fromDate` with an event posted for a raid event, earliest first.
  postedDates(guildId, raidEventId, fromDate) {
    return this.db
      .prepare(
        `SELECT event_date AS date FROM posted_events
         WHERE guild_id = ? AND raid_event_id = ? AND event_date >= ? ORDER BY event_date`,
      )
      .all(guildId, raidEventId, fromDate)
      .map((row) => row.date);
  }

  recordPostedEvent(guildId, { raidEventId, date, eventId, postedBy = null }, now) {
    this.db
      .prepare(
        // A record for the same event is kept as it is, so finding an event again does not wipe
        // who posted it.
        `INSERT INTO posted_events
           (guild_id, raid_event_id, event_date, event_id, posted_by, posted_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, raid_event_id, event_date) DO UPDATE SET
           event_id = excluded.event_id,
           posted_by = excluded.posted_by,
           posted_at = excluded.posted_at
         WHERE posted_events.event_id <> excluded.event_id`,
      )
      .run(guildId, raidEventId, date, eventId, postedBy, now);
  }

  // Records `now` as the first time each event was seen, unless it was seen before. Returns a Map
  // of event ID → first-seen time for the given events.
  markSeen(guildId, events, now) {
    const insert = this.db.prepare(
      `INSERT INTO events_seen (guild_id, event_id, first_seen_at, start_time) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id, event_id) DO UPDATE SET start_time = excluded.start_time`,
    );
    const select = this.db.prepare(
      'SELECT first_seen_at AS firstSeenAt FROM events_seen WHERE guild_id = ? AND event_id = ?',
    );
    const seen = new Map();
    for (const event of events) {
      insert.run(guildId, event.id, now, event.startTime);
      seen.set(event.id, select.get(guildId, event.id).firstSeenAt);
    }
    return seen;
  }

  // Reminder points already handled for an event at its current start time.
  sentReminderPoints(guildId, eventId, startTime) {
    const rows = this.db
      .prepare(
        `SELECT point FROM reminders_sent
         WHERE guild_id = ? AND event_id = ? AND start_time = ?`,
      )
      .all(guildId, eventId, startTime);
    return new Set(rows.map((row) => row.point));
  }

  markReminderSent(guildId, eventId, startTime, point, now) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO reminders_sent (guild_id, event_id, start_time, point, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(guildId, eventId, startTime, point, now);
  }

  // IDs of members already DMed about an event.
  dmedUserIds(guildId, eventId) {
    const rows = this.db
      .prepare('SELECT user_id AS userId FROM member_dms WHERE guild_id = ? AND event_id = ?')
      .all(guildId, eventId);
    return new Set(rows.map((row) => row.userId));
  }

  recordMemberDm(guildId, { eventId, userId, startTime }, now) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO member_dms (guild_id, event_id, user_id, start_time, sent_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(guildId, eventId, userId, startTime, now);
  }

  recordMemberAnswer(guildId, { eventId, userId, answer }, now) {
    this.db
      .prepare(
        `UPDATE member_dms SET answer = ?, answered_at = ?
         WHERE guild_id = ? AND event_id = ? AND user_id = ?`,
      )
      .run(answer, now, guildId, eventId, userId);
  }

  // Deletes rows about events that started more than RETENTION_SECONDS before `now`, and channels
  // no longer watched, in every guild. Absences and raid setup are kept.
  cleanup(now) {
    this.db.prepare('DELETE FROM watched_channels WHERE watch_until <= ?').run(now);
    const cutoff = now - RETENTION_SECONDS;
    // A day either way does not matter here, so the UTC date is close enough.
    const cutoffDate = new Date(cutoff * 1000).toISOString().slice(0, 10);
    this.db.prepare('DELETE FROM events_seen WHERE start_time < ?').run(cutoff);
    this.db.prepare('DELETE FROM reminders_sent WHERE start_time < ?').run(cutoff);
    this.db.prepare('DELETE FROM member_dms WHERE start_time < ?').run(cutoff);
    this.db.prepare('DELETE FROM posted_events WHERE event_date < ?').run(cutoffDate);
  }
}
