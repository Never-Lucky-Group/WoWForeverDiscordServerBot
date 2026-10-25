import { openSqliteDatabase } from '../lib/sqlite.js';

// Schema migrations, applied in order by openSqliteDatabase(). Append new migrations to the end and
// never edit one that has shipped.
const MIGRATIONS = [
  `
  -- A member's absence from raids. Dates are YYYY-MM-DD in the server's raid time zone; both ends
  -- are inclusive. AUTOINCREMENT so a cancelled absence's number is never reused.
  CREATE TABLE absences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    starts_on TEXT NOT NULL,
    ends_on TEXT NOT NULL,
    reason TEXT,
    created_by TEXT NOT NULL,        -- Discord user ID
    created_at INTEGER NOT NULL,     -- Unix seconds
    source TEXT NOT NULL             -- 'command', or 'dm' for a "Can't make it" answer
  );
  CREATE INDEX absences_guild ON absences (guild_id, ends_on);

  -- Events the bot posted (or found already posted) for a configured event on a date, so the
  -- weekly schedule never posts the same one twice.
  CREATE TABLE posted_events (
    guild_id TEXT NOT NULL,
    event_name TEXT NOT NULL,        -- the configured event's name
    event_date TEXT NOT NULL,        -- YYYY-MM-DD in the server's raid time zone
    event_id TEXT NOT NULL,          -- Raid-Helper event ID (the event message's ID)
    posted_by TEXT,                  -- Discord user ID; NULL for the weekly schedule
    posted_at INTEGER NOT NULL,      -- Unix seconds
    PRIMARY KEY (guild_id, event_name, event_date)
  );

  -- When the bot first saw each Raid-Helper event. Reminder points from before then are skipped,
  -- so an event posted shortly before it starts is not reported straight away.
  CREATE TABLE events_seen (
    guild_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,  -- Unix seconds
    start_time INTEGER NOT NULL,     -- Unix seconds; for cleanup
    PRIMARY KEY (guild_id, event_id)
  );

  -- Reminder points already handled. Keyed by the event's start time too, so moving an event
  -- makes its reminders fire again.
  CREATE TABLE reminders_sent (
    guild_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,     -- Unix seconds
    point TEXT NOT NULL,             -- e.g. '24h', or 'close'
    sent_at INTEGER NOT NULL,        -- Unix seconds
    PRIMARY KEY (guild_id, event_id, start_time, point)
  );

  -- Members DMed about an event they had not signed up for, and their answer.
  CREATE TABLE member_dms (
    guild_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    start_time INTEGER NOT NULL,     -- Unix seconds; for cleanup
    sent_at INTEGER NOT NULL,        -- Unix seconds
    answer TEXT,                     -- 'yes', 'no' or NULL
    answered_at INTEGER,             -- Unix seconds
    PRIMARY KEY (guild_id, event_id, user_id)
  );
  `,
  `
  -- Raid setup moved from config.json to /raidsetup.

  -- A server's raid settings. A server without a row uses the defaults in raids/setup.js.
  CREATE TABLE raid_settings (
    guild_id TEXT PRIMARY KEY,
    absence_channel_id TEXT,         -- where /absence add posts; NULL until set
    raider_role_id TEXT,             -- the shared roster role, for events without their own
    time_zone TEXT,                  -- IANA time zone; NULL for raidReset's
    reminder_hours TEXT NOT NULL,    -- JSON array of hours before an event, e.g. [48,24]
    member_dms INTEGER NOT NULL,     -- 1 to DM missing members too
    updated_by TEXT NOT NULL,        -- Discord user ID
    updated_at INTEGER NOT NULL      -- Unix seconds
  );

  -- The kinds of Raid-Helper event the bot can post, set up with /raidsetup event. Events in an
  -- event's channel are checked for missing sign-ups, whoever posted them. AUTOINCREMENT so a
  -- removed event's ID is never reused by posted_events.
  CREATE TABLE raid_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,              -- unique per server, ignoring case (checked in code)
    channel_id TEXT NOT NULL,
    template_id TEXT NOT NULL,       -- a built-in Raid-Helper template
    leader_id TEXT NOT NULL,         -- Discord user ID; gets the reports
    raider_role_id TEXT,             -- NULL for the shared roster role
    title TEXT,                      -- NULL for the name
    description TEXT,
    weekday TEXT,                    -- the weekly time, e.g. 'wednesday'; all three or none
    time TEXT,                       -- HH:MM in the server's raid time zone
    post_days_ahead INTEGER,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX raid_events_guild ON raid_events (guild_id);

  -- Channels still checked after their event was removed or moved to another channel, so sheets
  -- already posted there keep their reminders until they start.
  CREATE TABLE watched_channels (
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    raider_role_id TEXT,             -- the removed event's own role; NULL for the shared role
    event_name TEXT NOT NULL,        -- for /raidsetup event list
    watch_until INTEGER NOT NULL,    -- Unix seconds: when the last sheet there starts
    PRIMARY KEY (guild_id, channel_id)
  );

  -- Posted events are now keyed by the raid event's ID, so renaming an event does not post a date
  -- again. The old rows were keyed by name and only existed on test servers.
  DROP TABLE posted_events;
  CREATE TABLE posted_events (
    guild_id TEXT NOT NULL,
    raid_event_id INTEGER NOT NULL,  -- raid_events.id
    event_date TEXT NOT NULL,        -- YYYY-MM-DD in the server's raid time zone
    event_id TEXT NOT NULL,          -- Raid-Helper event ID (the event message's ID)
    posted_by TEXT,                  -- Discord user ID; NULL for the weekly schedule
    posted_at INTEGER NOT NULL,      -- Unix seconds
    PRIMARY KEY (guild_id, raid_event_id, event_date)
  );
  `,
];

// Opens (creating if needed) the raids database at `filePath` and brings its schema up to date.
// Pass ':memory:' for a throwaway database.
export function openRaidsDatabase(filePath) {
  return openSqliteDatabase(filePath, MIGRATIONS, 'raids');
}
