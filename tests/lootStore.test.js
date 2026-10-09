import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openLootDatabase } from '../src/loot/database.js';
import { splitIntoSessions } from '../src/loot/sessions.js';
import { fixtureAwards, memoryStore } from './helpers/loot.js';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000002';
const OFFICER = '300000000000000001';

// Imports the fixture as Molten Core + Onyxia.
function importFixture(store, { guildId = GUILD, awards = fixtureAwards() } = {}) {
  const raids = ['Molten Core', 'Onyxia'];
  const sessions = splitIntoSessions(awards).map((session, index) => ({
    ...session,
    raid: raids[index],
  }));
  return store.createImport({
    guildId,
    uploadedBy: OFFICER,
    fileName: 'export.json',
    sessions,
    now: 1_800_000_000,
  });
}

describe('openLootDatabase', () => {
  it('creates the file and its directory, and reopens it', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'loot-db-'));
    const file = path.join(dir, 'nested', 'loot.sqlite');
    openLootDatabase(file).close();
    const db = openLootDatabase(file);
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(1);
    db.close();
  });

  it('refuses a database from a newer bot version', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'loot-db-'));
    const file = path.join(dir, 'loot.sqlite');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA user_version = 99');
    db.close();
    expect(() => openLootDatabase(file)).toThrow(/rolled back/);
  });
});

describe('LootStore', () => {
  describe('createImport', () => {
    it('stores sessions and awards', () => {
      const store = memoryStore();
      expect(importFixture(store)).toEqual({ importId: 1, inserted: 10, skipped: 0 });
      const entry = store.getImport(GUILD, 1);
      expect(entry).toMatchObject({
        id: 1,
        uploadedBy: OFFICER,
        uploadedAt: 1_800_000_000,
        fileName: 'export.json',
        replacedAt: null,
        awardCount: 10,
      });
      expect(entry?.sessions.map((session) => [session.raid, session.awardCount])).toEqual([
        ['Molten Core', 7],
        ['Onyxia', 3],
      ]);
    });

    it('skips awards that are already stored', () => {
      const store = memoryStore();
      importFixture(store);
      const awards = fixtureAwards();
      const result = importFixture(store, {
        awards: [awards[0], { ...awards[1], checksum: 'new' }],
      });
      expect(result).toEqual({ importId: 2, inserted: 1, skipped: 1 });
      expect(store.getImport(GUILD, 2)?.awardCount).toBe(1);
    });

    it('stores nothing when every award is already stored', () => {
      const store = memoryStore();
      importFixture(store);
      expect(importFixture(store)).toEqual({ importId: null, inserted: 0, skipped: 10 });
      expect(store.listImports(GUILD).map((entry) => entry.id)).toEqual([1]);
    });

    it('never reuses the number of a deleted import', () => {
      const store = memoryStore();
      importFixture(store);
      store.deleteImport(GUILD, 1);
      expect(importFixture(store).importId).toBe(2);
    });

    it('keeps guilds apart', () => {
      const store = memoryStore();
      importFixture(store);
      expect(importFixture(store, { guildId: OTHER_GUILD }).inserted).toBe(10);
      expect(store.getImport(OTHER_GUILD, 1)).toBeNull();
      expect(store.characterAwards(OTHER_GUILD, 'Thrall')).toHaveLength(3);
    });
  });

  describe('findAwards', () => {
    it('returns stored awards with their import', () => {
      const store = memoryStore();
      importFixture(store);
      const found = store.findAwards(GUILD, ['a1b2c3d4e5f6a7b8c9d0', 'missing']);
      expect([...found.keys()]).toEqual(['a1b2c3d4e5f6a7b8c9d0']);
      expect(found.get('a1b2c3d4e5f6a7b8c9d0')).toMatchObject({
        importId: 1,
        raid: 'Molten Core',
        character: 'Thrall',
        softReserved: 1,
      });
    });

    it('handles more checksums than one query takes', () => {
      const store = memoryStore();
      importFixture(store);
      const checksums = Array.from({ length: 1200 }, (_, i) => `x${i}`);
      checksums.push('a1b2c3d4e5f6a7b8c9d0');
      expect(store.findAwards(GUILD, checksums).size).toBe(1);
    });
  });

  describe('replaceImport', () => {
    it("swaps an import's awards and keeps its ID", () => {
      const store = memoryStore();
      importFixture(store);
      const [first] = fixtureAwards();
      const result = store.replaceImport({
        guildId: GUILD,
        importId: 1,
        uploadedBy: '300000000000000002',
        fileName: 'fixed.json',
        sessions: [
          { raid: 'Onyxia', startedAt: 1, endedAt: 1, awards: [{ ...first, character: 'Jaina' }] },
        ],
        now: 1_800_000_100,
      });
      expect(result).toEqual({ inserted: 1, skipped: 0, removed: 10 });
      expect(store.getImport(GUILD, 1)).toMatchObject({
        fileName: 'fixed.json',
        uploadedBy: '300000000000000002',
        replacedAt: 1_800_000_100,
        awardCount: 1,
      });
      expect(store.characterAwards(GUILD, 'Jaina').map((award) => award.itemId)).toEqual([16800]);
    });

    it('changes nothing if the replacement would be empty', () => {
      const store = memoryStore();
      importFixture(store);
      const otherAwards = fixtureAwards().map((award) => ({
        ...award,
        checksum: `other-${award.checksum}`,
      }));
      importFixture(store, { awards: otherAwards });
      const result = store.replaceImport({
        guildId: GUILD,
        importId: 1,
        uploadedBy: OFFICER,
        fileName: 'x.json',
        sessions: [{ raid: 'Onyxia', startedAt: 1, endedAt: 1, awards: otherAwards }],
      });
      expect(result).toBeNull();
      expect(store.getImport(GUILD, 1)?.awardCount).toBe(10);
    });

    it('returns null for an unknown import', () => {
      const store = memoryStore();
      expect(
        store.replaceImport({
          guildId: GUILD,
          importId: 9,
          uploadedBy: OFFICER,
          fileName: 'x',
          sessions: [],
        }),
      ).toBeNull();
    });
  });

  describe('deleteImport', () => {
    it('removes the import, its sessions and awards', () => {
      const store = memoryStore();
      importFixture(store);
      expect(store.deleteImport(GUILD, 1)).toBe(10);
      expect(store.listImports(GUILD)).toEqual([]);
      expect(store.recentSessions(GUILD)).toEqual([]);
      expect(store.findAwards(GUILD, ['a1b2c3d4e5f6a7b8c9d0']).size).toBe(0);
    });

    it('returns null for an unknown import or another guild', () => {
      const store = memoryStore();
      importFixture(store);
      expect(store.deleteImport(GUILD, 2)).toBeNull();
      expect(store.deleteImport(OTHER_GUILD, 1)).toBeNull();
    });
  });

  describe('queries', () => {
    const store = memoryStore();
    importFixture(store);

    it('finds a character by name, with or without realm, in any case', () => {
      expect(store.characterAwards(GUILD, 'thrall').map((award) => award.itemName)).toEqual([
        'Arcanist Boots',
        'Arcanist Crown',
        'Head of Onyxia',
      ]);
      expect(store.characterAwards(GUILD, 'Thrall-wowforever')).toHaveLength(3);
      expect(store.characterAwards(GUILD, 'Thrall-OtherRealm')).toHaveLength(0);
    });

    it('never credits disenchanted items to anyone', () => {
      expect(store.characterAwards(GUILD, 'Disenchanted')).toEqual([]);
      expect(store.itemAwards(GUILD, '18264')).toEqual([]);
      expect(store.leaderboard(GUILD).some((row) => row.character === 'Disenchanted')).toBe(false);
    });

    it('filters by raid, time and award type', () => {
      expect(store.characterAwards(GUILD, 'Thrall', { raid: 'onyxia' })).toHaveLength(1);
      expect(store.characterAwards(GUILD, 'Thrall', { type: 'off-spec' })).toHaveLength(1);
      expect(store.characterAwards(GUILD, 'Thrall', { type: 'main-spec' })).toHaveLength(2);
      expect(store.characterAwards(GUILD, 'Garrosh', { type: 'main-spec' })).toHaveLength(1);
      expect(store.characterAwards(GUILD, 'Garrosh', { type: 'bonus' })).toHaveLength(1);
      const onyxiaStart = Date.parse('2026-11-12T00:00:00Z') / 1000;
      expect(store.characterAwards(GUILD, 'Jaina', { since: onyxiaStart })).toHaveLength(1);
      expect(store.characterAwards(GUILD, 'Jaina', { until: onyxiaStart })).toHaveLength(2);
    });

    it('finds an item by ID or exact name', () => {
      expect(store.itemAwards(GUILD, '17182').map((award) => award.character)).toEqual(['Garrosh']);
      expect(store.itemAwards(GUILD, 'head of onyxia').map((award) => award.character)).toEqual([
        'Thrall',
      ]);
    });

    it('lists a whole session including disenchanted items', () => {
      const [moltenCore] = store.getImport(GUILD, 1)?.sessions ?? [];
      const awards = store.sessionAwards(GUILD, moltenCore.id);
      expect(awards).toHaveLength(7);
      expect(awards.some((award) => award.disenchanted === 1)).toBe(true);
    });

    it('ranks characters by items received', () => {
      expect(store.leaderboard(GUILD)).toEqual([
        { character: 'Jaina', realm: 'WoWForever', count: 3 },
        { character: 'Thrall', realm: 'WoWForever', count: 3 },
        { character: 'Garrosh', realm: 'WoWForever', count: 2 },
        { character: 'Sylvanas', realm: 'WoWForever', count: 1 },
      ]);
      expect(store.leaderboard(GUILD, { raid: 'Onyxia' })).toHaveLength(3);
    });

    it('suggests the raid that shares the most items', () => {
      expect(store.suggestRaid(GUILD, [16800, 17063, 18423], ['Molten Core', 'Onyxia'])).toBe(
        'Molten Core',
      );
      expect(store.suggestRaid(GUILD, [18423], ['Molten Core', 'Onyxia'])).toBe('Onyxia');
      expect(store.suggestRaid(GUILD, [18423], ['Molten Core'])).toBeNull();
      expect(store.suggestRaid(GUILD, [1], ['Molten Core', 'Onyxia'])).toBeNull();
      // A raid renamed only in case in the config still matches, spelled the new way.
      expect(store.suggestRaid(GUILD, [16800], ['MOLTEN CORE'])).toBe('MOLTEN CORE');
    });

    it('searches characters and items for autocomplete', () => {
      expect(store.searchCharacters(GUILD, 'ja')).toEqual(['Jaina-WoWForever']);
      expect(store.searchCharacters(GUILD, 'thrall-wo')).toEqual(['Thrall-WoWForever']);
      expect(store.searchCharacters(GUILD, '%')).toEqual([]);
      expect(store.searchItems(GUILD, 'arcanist')).toEqual([
        { itemId: 16800, itemName: 'Arcanist Boots' },
        { itemId: 16795, itemName: 'Arcanist Crown' },
      ]);
      expect(store.searchItems(GUILD, '1718')).toEqual([
        { itemId: 17182, itemName: 'Sulfuras, Hand of Ragnaros' },
      ]);
    });
  });
});
