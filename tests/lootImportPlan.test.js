import { describe, expect, it } from 'vitest';
import { compareAward, planImport } from '../src/loot/importPlan.js';
import { splitIntoSessions } from '../src/loot/sessions.js';
import { fixtureAwards, memoryStore } from './helpers/loot.js';

const GUILD = '100000000000000001';
const RAIDS = ['Molten Core', 'Onyxia'];

function storeWithFixture() {
  const store = memoryStore();
  const sessions = splitIntoSessions(fixtureAwards()).map((session, index) => ({
    ...session,
    raid: RAIDS[index],
  }));
  store.createImport({ guildId: GUILD, uploadedBy: '1', fileName: 'a.json', sessions });
  return store;
}

describe('planImport', () => {
  it('plans every award as new on an empty database', () => {
    const plan = planImport({
      store: memoryStore(),
      guildId: GUILD,
      awards: fixtureAwards(),
      raids: RAIDS,
    });
    expect(plan.newCount).toBe(10);
    expect(plan.storedCount).toBe(0);
    expect(plan.discrepancies).toEqual([]);
    expect(
      plan.newSessions.map((session) => [session.awards.length, session.suggestedRaid]),
    ).toEqual([
      [7, null],
      [3, null],
    ]);
  });

  it('skips stored awards and suggests raids from earlier imports', () => {
    const store = storeWithFixture();
    const awards = [
      ...fixtureAwards(),
      // A new Onyxia night a week later, with an item seen in the first Onyxia session.
      {
        ...fixtureAwards()[7],
        checksum: 'next-week',
        awardedAt: fixtureAwards()[7].awardedAt + 7 * 86400,
      },
    ];
    const plan = planImport({ store, guildId: GUILD, awards, raids: RAIDS });
    expect(plan.storedCount).toBe(10);
    expect(plan.newCount).toBe(1);
    expect(plan.newSessions).toHaveLength(1);
    expect(plan.newSessions[0].suggestedRaid).toBe('Onyxia');
  });

  it('reports stored awards that differ from the upload', () => {
    const store = storeWithFixture();
    const awards = fixtureAwards();
    awards[0] = { ...awards[0], character: 'Jaina', softReserved: false };
    const plan = planImport({ store, guildId: GUILD, awards, raids: RAIDS });
    expect(plan.newCount).toBe(0);
    expect(plan.discrepancies).toHaveLength(1);
    expect(plan.discrepancies[0].differences).toEqual([
      { field: 'character', label: 'winner', stored: 'Thrall', incoming: 'Jaina' },
      { field: 'softReserved', label: 'soft reserved', stored: 1, incoming: 0 },
    ]);
  });

  it("treats the replaced import's own awards as new", () => {
    const store = storeWithFixture();
    const plan = planImport({
      store,
      guildId: GUILD,
      awards: fixtureAwards(),
      raids: RAIDS,
      replacingImportId: 1,
    });
    expect(plan.newCount).toBe(10);
    expect(plan.storedCount).toBe(0);
  });
});

describe('compareAward', () => {
  it('finds no differences for the same award', () => {
    const store = storeWithFixture();
    const [award] = fixtureAwards();
    const stored = store.findAwards(GUILD, [award.checksum]).get(award.checksum);
    expect(compareAward(stored, award)).toEqual([]);
  });
});
