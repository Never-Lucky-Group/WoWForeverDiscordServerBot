import { openSqliteDatabase, transaction } from '../lib/sqlite.js';

// Schema migrations, applied in order by openSqliteDatabase(). Append new migrations to the end and
// never edit one that has shipped.
const MIGRATIONS = [
  `
  -- One uploaded Gargul export. AUTOINCREMENT so a deleted import's number is never reused: a
  -- delete or replace prompt left open must not act on a newer import.
  CREATE TABLE imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,       -- Discord user ID
    uploaded_at INTEGER NOT NULL,    -- Unix seconds
    file_name TEXT NOT NULL,
    replaced_at INTEGER              -- Unix seconds of the last /loot imports replace
  );
  CREATE INDEX imports_guild ON imports (guild_id, id);

  -- A run of awards with no gap of 6 hours or more, labelled with a raid by the officer.
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    import_id INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
    guild_id TEXT NOT NULL,
    raid TEXT NOT NULL,
    started_at INTEGER NOT NULL,     -- Unix seconds of the first award
    ended_at INTEGER NOT NULL        -- Unix seconds of the last award
  );
  CREATE INDEX sessions_import ON sessions (import_id);
  CREATE INDEX sessions_guild ON sessions (guild_id, started_at);

  -- One awarded item. checksum is Gargul's unique ID for the award.
  CREATE TABLE awards (
    guild_id TEXT NOT NULL,
    checksum TEXT NOT NULL,
    session_id INTEGER NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    awarded_at INTEGER NOT NULL,     -- Unix seconds
    character TEXT NOT NULL,
    realm TEXT,
    disenchanted INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    item_link TEXT NOT NULL,
    awarded_by TEXT,
    winner_class TEXT,
    off_spec INTEGER NOT NULL,
    soft_reserved INTEGER NOT NULL,
    wishlisted INTEGER NOT NULL,
    prioritized INTEGER NOT NULL,
    bonus_loot INTEGER NOT NULL,
    roll_type TEXT,
    PRIMARY KEY (guild_id, checksum)
  );
  CREATE INDEX awards_session ON awards (session_id);
  CREATE INDEX awards_character ON awards (guild_id, character COLLATE NOCASE, awarded_at);
  CREATE INDEX awards_item ON awards (guild_id, item_id);
  CREATE INDEX awards_time ON awards (guild_id, awarded_at);
  `,
];

// Opens (creating if needed) the loot database at `filePath` and brings its schema up to date.
// Pass ':memory:' for a throwaway database.
export function openLootDatabase(filePath) {
  return openSqliteDatabase(filePath, MIGRATIONS, 'loot');
}

export { transaction };
