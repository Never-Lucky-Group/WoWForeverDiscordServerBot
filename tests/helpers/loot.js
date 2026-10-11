import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openLootDatabase } from '../../src/loot/database.js';
import { parseGargulExport } from '../../src/loot/gargulExport.js';
import { LootStore } from '../../src/loot/store.js';

export const FIXTURE_PATH = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'gargul',
  'detailed-export.json',
);

// The generated sample export: two sessions (Molten Core past midnight, then Onyxia), with a
// disenchanted item, a bonus roll and an award without a checksum.
export function fixtureText() {
  return readFileSync(FIXTURE_PATH, 'utf8');
}

export function fixtureEntries() {
  return JSON.parse(fixtureText());
}

export function fixtureAwards() {
  return parseGargulExport(fixtureText());
}

export function memoryStore() {
  return new LootStore(openLootDatabase(':memory:'));
}
