import { transaction } from './database.js';
import { splitPlayerName } from './gargulExport.js';

// Award type filters offered by the loot commands, as SQL conditions on the awards table.
export const AWARD_TYPES = {
  'main-spec': { label: 'Main spec', sql: 'a.off_spec = 0 AND a.bonus_loot = 0' },
  'off-spec': { label: 'Off spec', sql: 'a.off_spec = 1' },
  'soft-reserve': { label: 'Soft reserved', sql: 'a.soft_reserved = 1' },
  wishlist: { label: 'Wishlisted', sql: 'a.wishlisted = 1' },
  priority: { label: 'Prioritized', sql: 'a.prioritized = 1' },
  bonus: { label: 'Bonus roll', sql: 'a.bonus_loot = 1' },
};

// Columns returned for each award by the query methods.
const AWARD_COLUMNS = `
  a.checksum, a.session_id AS sessionId, s.import_id AS importId, s.raid, a.awarded_at AS awardedAt,
  a.character, a.realm, a.disenchanted, a.item_id AS itemId, a.item_name AS itemName,
  a.off_spec AS offSpec, a.soft_reserved AS softReserved, a.wishlisted, a.prioritized,
  a.bonus_loot AS bonusLoot, a.roll_type AS rollType`;

// Fields compared to find discrepancies between a stored award and a re-uploaded one.
export const COMPARED_FIELDS = [
  ['character', 'winner'],
  ['realm', 'realm'],
  ['disenchanted', 'disenchanted'],
  ['itemId', 'item'],
  ['awardedAt', 'time'],
  ['offSpec', 'off spec'],
  ['softReserved', 'soft reserved'],
  ['wishlisted', 'wishlisted'],
  ['prioritized', 'prioritized'],
  ['bonusLoot', 'bonus roll'],
  ['rollType', 'roll type'],
];

const CHUNK_SIZE = 500;

// All reads and writes of Gargul loot data. Every method is scoped to one Discord guild.
// Times are Unix seconds. Booleans are stored and returned as 0 or 1.
export class LootStore {
  constructor(db) {
    this.db = db;
  }

  // Stored awards among `checksums`, as a Map of checksum → award row.
  findAwards(guildId, checksums) {
    const found = new Map();
    for (let start = 0; start < checksums.length; start += CHUNK_SIZE) {
      const chunk = checksums.slice(start, start + CHUNK_SIZE);
      const rows = this.db
        .prepare(
          `SELECT ${AWARD_COLUMNS}
           FROM awards a JOIN sessions s ON s.id = a.session_id
           WHERE a.guild_id = ? AND a.checksum IN (${placeholders(chunk)})`,
        )
        .all(guildId, ...chunk);
      for (const row of rows) found.set(row.checksum, row);
    }
    return found;
  }

  // The raid in `raids` whose stored awards share the most distinct items with `itemIds`, or
  // null if none share any. Raid names match without regard to case; the result is spelled as in
  // `raids`.
  suggestRaid(guildId, itemIds, raids) {
    const items = [...new Set(itemIds)];
    if (items.length === 0 || raids.length === 0) return null;
    const row = this.db
      .prepare(
        `SELECT s.raid, COUNT(DISTINCT a.item_id) AS shared
         FROM awards a JOIN sessions s ON s.id = a.session_id
         WHERE a.guild_id = ? AND a.item_id IN (${placeholders(items)})
           AND s.raid COLLATE NOCASE IN (${placeholders(raids)})
         GROUP BY s.raid COLLATE NOCASE
         ORDER BY shared DESC, MAX(a.awarded_at) DESC
         LIMIT 1`,
      )
      .get(guildId, ...items, ...raids);
    if (!row) return null;
    return raids.find((raid) => raid.toLowerCase() === row.raid.toLowerCase()) ?? null;
  }

  // Stores a new import. `sessions` is [{ raid, startedAt, endedAt, awards }] with awards from
  // parseGargulExport. Awards already stored (by checksum) are left untouched and skipped.
  // Returns { importId, inserted, skipped }; importId is null and nothing is stored if every
  // award was already stored.
  createImport({ guildId, uploadedBy, fileName, sessions, now = nowSeconds() }) {
    return transaction(this.db, () => {
      const { lastInsertRowid } = this.db
        .prepare(
          'INSERT INTO imports (guild_id, uploaded_by, uploaded_at, file_name) VALUES (?, ?, ?, ?)',
        )
        .run(guildId, uploadedBy, now, fileName);
      const importId = Number(lastInsertRowid);
      const counts = this.#insertSessions(guildId, importId, sessions);
      if (counts.inserted === 0) {
        this.db.prepare('DELETE FROM imports WHERE id = ?').run(importId);
        return { importId: null, ...counts };
      }
      return { importId, ...counts };
    });
  }

  // Swaps the awards of an existing import for new ones, keeping its ID. Awards stored by other
  // imports are skipped. Returns { inserted, skipped, removed }, or null if the import does not
  // exist or the new file would leave it empty (nothing is changed then).
  replaceImport({ guildId, importId, uploadedBy, fileName, sessions, now = nowSeconds() }) {
    try {
      return transaction(this.db, () => {
        const existing = this.getImport(guildId, importId);
        if (!existing) return null;
        this.db.prepare('DELETE FROM sessions WHERE import_id = ?').run(importId);
        const counts = this.#insertSessions(guildId, importId, sessions);
        // Throwing rolls the deletion back.
        if (counts.inserted === 0) throw new EmptyReplacement();
        this.db
          .prepare(
            'UPDATE imports SET uploaded_by = ?, file_name = ?, replaced_at = ? WHERE id = ?',
          )
          .run(uploadedBy, fileName, now, importId);
        return { ...counts, removed: existing.awardCount };
      });
    } catch (error) {
      if (error instanceof EmptyReplacement) return null;
      throw error;
    }
  }

  // Deletes an import with its sessions and awards. Returns the number of awards removed, or
  // null if the import does not exist.
  deleteImport(guildId, importId) {
    return transaction(this.db, () => {
      const existing = this.getImport(guildId, importId);
      if (!existing) return null;
      this.db.prepare('DELETE FROM imports WHERE id = ?').run(importId);
      return existing.awardCount;
    });
  }

  // { id, uploadedBy, uploadedAt, fileName, replacedAt, awardCount, sessions: [...] } or null.
  getImport(guildId, importId) {
    const row = this.db
      .prepare(
        `SELECT i.id, i.uploaded_by AS uploadedBy, i.uploaded_at AS uploadedAt,
                i.file_name AS fileName, i.replaced_at AS replacedAt
         FROM imports i WHERE i.guild_id = ? AND i.id = ?`,
      )
      .get(guildId, importId);
    return row ? this.#withSessions(row) : null;
  }

  // Every import in the guild, newest first, in the same shape as getImport.
  listImports(guildId) {
    return this.db
      .prepare(
        `SELECT i.id, i.uploaded_by AS uploadedBy, i.uploaded_at AS uploadedAt,
                i.file_name AS fileName, i.replaced_at AS replacedAt
         FROM imports i WHERE i.guild_id = ? ORDER BY i.id DESC`,
      )
      .all(guildId)
      .map((row) => this.#withSessions(row));
  }

  // { id, importId, raid, startedAt, endedAt, awardCount } or null.
  getSession(guildId, sessionId) {
    return (
      this.db
        .prepare(
          `SELECT s.id, s.import_id AS importId, s.raid, s.started_at AS startedAt,
                  s.ended_at AS endedAt,
                  (SELECT COUNT(*) FROM awards a WHERE a.session_id = s.id) AS awardCount
           FROM sessions s WHERE s.guild_id = ? AND s.id = ?`,
        )
        .get(guildId, sessionId) ?? null
    );
  }

  // The most recent sessions, newest first, in the same shape as getSession.
  recentSessions(guildId, limit = 200) {
    return this.db
      .prepare(
        `SELECT s.id, s.import_id AS importId, s.raid, s.started_at AS startedAt,
                s.ended_at AS endedAt,
                (SELECT COUNT(*) FROM awards a WHERE a.session_id = s.id) AS awardCount
         FROM sessions s WHERE s.guild_id = ? ORDER BY s.started_at DESC LIMIT ?`,
      )
      .all(guildId, limit);
  }

  // Awards to a character (excluding disenchanted items), oldest first. `name` is "Name" or
  // "Name-Realm", matched without regard to case. `filters` is { since?, until?, raid?, type? }.
  characterAwards(guildId, name, filters = {}) {
    const { character, realm } = splitPlayerName(name.trim());
    const where = ['a.character = ? COLLATE NOCASE'];
    const params = [character];
    if (realm) {
      where.push('a.realm = ? COLLATE NOCASE');
      params.push(realm);
    }
    return this.#awards(guildId, where, params, { ...filters, includeDisenchanted: false });
  }

  // Awards of an item (excluding disenchanted ones), oldest first. `item` is an item ID or an
  // exact item name (any case).
  itemAwards(guildId, item, filters = {}) {
    const text = String(item).trim();
    const byId = /^\d+$/.test(text);
    return this.#awards(
      guildId,
      [byId ? 'a.item_id = ?' : 'a.item_name = ? COLLATE NOCASE'],
      [byId ? Number(text) : text],
      { ...filters, includeDisenchanted: false },
    );
  }

  // Every award in a session, including disenchanted items, oldest first.
  sessionAwards(guildId, sessionId) {
    return this.#awards(guildId, ['a.session_id = ?'], [sessionId], { includeDisenchanted: true });
  }

  // Characters ranked by items received (excluding disenchanted items):
  // [{ character, realm, count }], most first.
  leaderboard(guildId, filters = {}) {
    const { where, params } = filterSql(guildId, filters);
    return this.db
      .prepare(
        `SELECT a.character, a.realm, COUNT(*) AS count
         FROM awards a JOIN sessions s ON s.id = a.session_id
         WHERE ${where.join(' AND ')} AND a.disenchanted = 0
         GROUP BY a.character COLLATE NOCASE, a.realm COLLATE NOCASE
         ORDER BY count DESC, a.character COLLATE NOCASE`,
      )
      .all(...params);
  }

  // Distinct "Name-Realm" (or "Name") values starting with `prefix`, for autocomplete.
  searchCharacters(guildId, prefix, limit = 25) {
    return this.db
      .prepare(
        `SELECT DISTINCT a.character, a.realm FROM awards a
         WHERE a.guild_id = ? AND a.disenchanted = 0
           AND a.character || COALESCE('-' || a.realm, '') LIKE ? ESCAPE '\\'
         ORDER BY a.character COLLATE NOCASE, a.realm LIMIT ?`,
      )
      .all(guildId, `${escapeLike(prefix)}%`, limit)
      .map((row) => (row.realm ? `${row.character}-${row.realm}` : row.character));
  }

  // The stored name of an item ID (given as a number or numeric text), or null.
  itemName(guildId, itemId) {
    const text = String(itemId).trim();
    if (!/^\d+$/.test(text)) return null;
    return (
      this.db
        .prepare('SELECT MAX(item_name) AS name FROM awards WHERE guild_id = ? AND item_id = ?')
        .get(guildId, Number(text))?.name ?? null
    );
  }

  // [{ itemId, itemName }] whose name contains `text` (or whose ID starts with it).
  searchItems(guildId, text, limit = 25) {
    return this.db
      .prepare(
        `SELECT a.item_id AS itemId, MAX(a.item_name) AS itemName FROM awards a
         WHERE a.guild_id = ?
           AND (a.item_name LIKE ? ESCAPE '\\' OR CAST(a.item_id AS TEXT) LIKE ? ESCAPE '\\')
         GROUP BY a.item_id ORDER BY itemName COLLATE NOCASE LIMIT ?`,
      )
      .all(guildId, `%${escapeLike(text)}%`, `${escapeLike(text)}%`, limit);
  }

  #insertSessions(guildId, importId, sessions) {
    const insertSession = this.db.prepare(
      `INSERT INTO sessions (import_id, guild_id, raid, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertAward = this.db.prepare(
      `INSERT INTO awards (guild_id, checksum, session_id, awarded_at, character, realm,
         disenchanted, item_id, item_name, item_link, awarded_by, winner_class, off_spec,
         soft_reserved, wishlisted, prioritized, bonus_loot, roll_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (guild_id, checksum) DO NOTHING`,
    );
    const deleteSession = this.db.prepare('DELETE FROM sessions WHERE id = ?');

    let inserted = 0;
    let skipped = 0;
    for (const session of sessions) {
      const { lastInsertRowid } = insertSession.run(
        importId,
        guildId,
        session.raid,
        session.startedAt,
        session.endedAt,
      );
      const sessionId = Number(lastInsertRowid);
      let sessionInserted = 0;
      for (const award of session.awards) {
        const { changes } = insertAward.run(
          guildId,
          award.checksum,
          sessionId,
          award.awardedAt,
          award.character,
          award.realm,
          flag(award.disenchanted),
          award.itemId,
          award.itemName,
          award.itemLink,
          award.awardedBy,
          award.winnerClass,
          flag(award.offSpec),
          flag(award.softReserved),
          flag(award.wishlisted),
          flag(award.prioritized),
          flag(award.bonusLoot),
          award.rollType,
        );
        sessionInserted += Number(changes);
      }
      inserted += sessionInserted;
      skipped += session.awards.length - sessionInserted;
      // Another import stored all of this session's awards between preview and confirm.
      if (sessionInserted === 0) deleteSession.run(sessionId);
    }
    return { inserted, skipped };
  }

  #withSessions(importRow) {
    const sessions = this.db
      .prepare(
        `SELECT s.id, s.raid, s.started_at AS startedAt, s.ended_at AS endedAt,
                (SELECT COUNT(*) FROM awards a WHERE a.session_id = s.id) AS awardCount
         FROM sessions s WHERE s.import_id = ? ORDER BY s.started_at`,
      )
      .all(importRow.id);
    return {
      ...importRow,
      sessions,
      awardCount: sessions.reduce((total, session) => total + session.awardCount, 0),
    };
  }

  #awards(guildId, extraWhere, extraParams, filters) {
    const { where, params } = filterSql(guildId, filters);
    if (!filters.includeDisenchanted) where.push('a.disenchanted = 0');
    return this.db
      .prepare(
        `SELECT ${AWARD_COLUMNS}
         FROM awards a JOIN sessions s ON s.id = a.session_id
         WHERE ${[...where, ...extraWhere].join(' AND ')}
         ORDER BY a.awarded_at, a.checksum`,
      )
      .all(...params, ...extraParams);
  }
}

// Thrown inside replaceImport's transaction to roll it back.
class EmptyReplacement extends Error {}

function filterSql(guildId, { since, until, raid, type } = {}) {
  const where = ['a.guild_id = ?'];
  const params = [guildId];
  if (since !== undefined) {
    where.push('a.awarded_at >= ?');
    params.push(since);
  }
  if (until !== undefined) {
    where.push('a.awarded_at < ?');
    params.push(until);
  }
  if (raid !== undefined) {
    where.push('s.raid = ? COLLATE NOCASE');
    params.push(raid);
  }
  if (type !== undefined) {
    const awardType = AWARD_TYPES[type];
    if (!awardType) throw new Error(`Unknown award type "${type}"`);
    where.push(`(${awardType.sql})`);
  }
  return { where, params };
}

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function flag(value) {
  return value ? 1 : 0;
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
