import { describe, expect, it } from 'vitest';
import {
  GargulExportError,
  itemIdFromLink,
  itemNameFromLink,
  parseGargulExport,
  splitPlayerName,
} from '../src/loot/gargulExport.js';
import { fixtureAwards, fixtureEntries } from './helpers/loot.js';

describe('parseGargulExport', () => {
  it('reads every award, oldest first', () => {
    const awards = fixtureAwards();
    expect(awards).toHaveLength(10);
    expect(awards.map((award) => award.awardedAt)).toEqual(
      [...awards.map((award) => award.awardedAt)].sort((a, b) => a - b),
    );
  });

  it('maps Gargul fields to award fields', () => {
    const boots = fixtureAwards().find((award) => award.itemId === 16800);
    expect(boots).toEqual({
      checksum: 'a1b2c3d4e5f6a7b8c9d0',
      awardedAt: 1794339720,
      character: 'Thrall',
      realm: 'WoWForever',
      disenchanted: false,
      itemId: 16800,
      itemName: 'Arcanist Boots',
      itemLink: '|cffa335ee|Hitem:16800::::::::60:::::::::|h[Arcanist Boots]|h|r',
      awardedBy: 'Lootmaster-WoWForever',
      winnerClass: 'MAGE',
      offSpec: false,
      softReserved: true,
      wishlisted: false,
      prioritized: false,
      bonusLoot: false,
      rollType: 'MS',
    });
  });

  it('marks disenchanted items', () => {
    const plans = fixtureAwards().find((award) => award.itemId === 18264);
    expect(plans).toMatchObject({
      character: 'Disenchanted',
      realm: null,
      disenchanted: true,
      winnerClass: null,
      rollType: null,
    });
  });

  it('reads bonus loot and award flags', () => {
    const awards = fixtureAwards();
    expect(awards.find((award) => award.itemId === 17076)).toMatchObject({
      bonusLoot: true,
      rollType: 'Bonus Roll',
    });
    expect(awards.find((award) => award.itemId === 16795)?.offSpec).toBe(true);
    expect(awards.find((award) => award.itemId === 18814)?.wishlisted).toBe(true);
    expect(awards.find((award) => award.itemId === 17182)?.prioritized).toBe(true);
  });

  it('gives awards without a checksum a stable generated one', () => {
    const first = fixtureAwards().find((award) => award.itemId === 18205);
    const second = fixtureAwards().find((award) => award.itemId === 18205);
    expect(first?.checksum).toMatch(/^legacy-[0-9a-f]{20}$/);
    expect(first?.checksum).toBe(second?.checksum);
  });

  it('accepts 0/1 flags and a numeric string item ID', () => {
    const [entry] = fixtureEntries();
    Object.assign(entry, { OS: 1, SR: 0, isBonusLoot: 1, itemID: '16800' });
    expect(parseGargulExport(JSON.stringify([entry]))[0]).toMatchObject({
      itemId: 16800,
      offSpec: true,
      softReserved: false,
      bonusLoot: true,
    });
  });

  it('numbers repeated generated IDs instead of rejecting the file', () => {
    const legacy = fixtureEntries().find((entry) => entry.checksum === undefined);
    const awards = parseGargulExport(JSON.stringify([legacy, legacy, legacy]));
    const [first, second, third] = awards.map((award) => award.checksum);
    expect(second).toBe(`${first}-2`);
    expect(third).toBe(`${first}-3`);
  });

  it('reads the item name from a link whose codes were lost', () => {
    const [entry] = fixtureEntries();
    entry.itemLink = '[Arcanist Boots]';
    expect(parseGargulExport(JSON.stringify([entry]))[0].itemName).toBe('Arcanist Boots');
  });

  it('ignores a byte order mark at the start of the file', () => {
    expect(parseGargulExport(`\uFEFF${JSON.stringify(fixtureEntries())}`)).toHaveLength(10);
  });

  it('reads the item ID from the link when itemID is missing', () => {
    const [entry] = fixtureEntries();
    delete entry.itemID;
    expect(parseGargulExport(JSON.stringify([entry]))[0].itemId).toBe(16800);
  });

  it('falls back to the item ID when the link has no name', () => {
    const [entry] = fixtureEntries();
    entry.itemLink = '|Hitem:16800|h|r';
    expect(parseGargulExport(JSON.stringify([entry]))[0].itemName).toBe('Item 16800');
  });

  it.each([
    ['text that is not JSON', 'dateTime,character,itemID,offspec,id\n2026-11-10,Thrall,1,0,abc'],
    ['JSON that is not an export', '{"hello":"world"}'],
    ['awards missing required fields', '[{"itemLink":"x"}]'],
  ])('rejects %s with format instructions', (_label, text) => {
    expect(() => parseGargulExport(text)).toThrow(/Detailed \(JSON\)/);
  });

  it.each(['[]', '{}'])('rejects an export with no awards (%s)', (text) => {
    expect(() => parseGargulExport(text)).toThrow(/no awarded items/);
  });

  it('rejects an export that lists an award twice', () => {
    const [entry] = fixtureEntries();
    expect(() => parseGargulExport(JSON.stringify([entry, entry]))).toThrow(GargulExportError);
  });
});

describe('item link and name helpers', () => {
  it('reads item IDs and names from item links', () => {
    const link = '|cffff8000|Hitem:17182::::::::60:::::::::|h[Sulfuras, Hand of Ragnaros]|h|r';
    expect(itemIdFromLink(link)).toBe(17182);
    expect(itemNameFromLink(link)).toBe('Sulfuras, Hand of Ragnaros');
    expect(itemIdFromLink('no link')).toBeUndefined();
  });

  it('splits names on the first hyphen only', () => {
    expect(splitPlayerName('Thrall-Azjol-Nerub')).toEqual({
      character: 'Thrall',
      realm: 'Azjol-Nerub',
    });
    expect(splitPlayerName('Thrall')).toEqual({ character: 'Thrall', realm: null });
  });
});
