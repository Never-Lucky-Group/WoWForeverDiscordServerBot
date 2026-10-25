import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Opens (creating if needed) the SQLite database at `filePath` and applies `migrations`, a list of
// SQL scripts run in order. PRAGMA user_version records how many have run, so append new
// migrations to the end and never edit one that has shipped. `label` names the database in
// errors, e.g. 'loot'. Pass ':memory:' for a throwaway database.
export function openSqliteDatabase(filePath, migrations, label) {
  if (filePath !== ':memory:') mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  migrate(db, migrations, label);
  return db;
}

function migrate(db, migrations, label) {
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  if (version > migrations.length) {
    throw new Error(
      `The ${label} database is at schema version ${version}, newer than this bot supports ` +
        `(${migrations.length}). Was the bot rolled back?`,
    );
  }
  for (let index = version; index < migrations.length; index++) {
    transaction(db, () => {
      db.exec(migrations[index]);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}

// Runs fn inside a transaction, rolling back if it throws. Returns fn's result.
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
