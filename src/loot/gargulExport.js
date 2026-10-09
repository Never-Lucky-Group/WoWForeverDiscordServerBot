import { createHash } from 'node:crypto';
import { z } from 'zod';

// Parses Gargul's "Detailed (JSON)" loot export (Gargul → /gl export, with Settings → Exporting
// loot → format set to "Detailed (JSON)"). The export is Gargul's AwardHistory: one object per
// awarded item, as built by AwardedLoot:addWinner in Gargul's Classes/AwardedLoot.lua. Only the
// fields the bot uses are validated; the rest (Rolls, GDKP data, ...) are ignored.

// Thrown when an upload is not a usable Gargul JSON export. The message is shown to the officer.
export class GargulExportError extends Error {
  name = 'GargulExportError';
}

const LEGACY_PREFIX = 'legacy-';

// Gargul's awardedTo value for items given to the disenchanter.
export const DISENCHANTED_AWARD = '||de||';

// Flags are booleans in current Gargul versions; accept 0/1 too in case older data stored numbers.
const flag = z.union([z.boolean(), z.literal(0), z.literal(1)]).optional();

const awardEntrySchema = z.object({
  // Older Gargul versions did not store a checksum, see parseGargulExport.
  checksum: z.string().min(1).optional(),
  // Unix time in seconds.
  timestamp: z.number().int().positive(),
  itemLink: z.string().min(1),
  itemID: z.coerce.number().int().positive().optional(),
  awardedTo: z.string().min(1),
  awardedBy: z.string().optional(),
  winnerClass: z.string().optional(),
  OS: flag,
  SR: flag,
  WL: flag,
  PL: flag,
  isBonusLoot: flag,
  winningRollType: z.string().optional(),
});

// Lua's JSON encoder turns an empty table into {} rather than [].
const exportSchema = z.union([z.array(awardEntrySchema), z.strictObject({})]);

const NOT_JSON_MESSAGE =
  'This file is not a Gargul JSON export. In Gargul, open Settings → Exporting loot, set the ' +
  'export format to "Detailed (JSON)", then run /gl export and save the text as a .json file.';

// Returns the awards in the export, oldest first:
//   { checksum, awardedAt, character, realm, disenchanted, itemId, itemName, itemLink,
//     awardedBy, winnerClass, offSpec, softReserved, wishlisted, prioritized, bonusLoot,
//     rollType }
// Throws GargulExportError if the text is not a valid export or holds no awards.
export function parseGargulExport(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new GargulExportError(NOT_JSON_MESSAGE);
  }

  const result = exportSchema.safeParse(raw);
  if (!result.success) {
    throw new GargulExportError(
      `${NOT_JSON_MESSAGE}\n\nDetails: ${z.prettifyError(result.error).slice(0, 500)}`,
    );
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    throw new GargulExportError('The export contains no awarded items.');
  }

  const awards = result.data.map(toAward);
  const checksums = new Set();
  for (const award of awards) {
    // Two old awards of the same item to the same winner in the same second get the same
    // generated ID; number the repeats. Gargul's own IDs are unique, so a repeat is an error.
    if (award.checksum.startsWith(LEGACY_PREFIX)) {
      const base = award.checksum;
      for (let repeat = 2; checksums.has(award.checksum); repeat++) {
        award.checksum = `${base}-${repeat}`;
      }
    }
    if (checksums.has(award.checksum)) {
      throw new GargulExportError(
        `The export lists the same award (${award.checksum}) more than once.`,
      );
    }
    checksums.add(award.checksum);
  }
  return awards.sort((a, b) => a.awardedAt - b.awardedAt);
}

function toAward(entry) {
  const itemId = entry.itemID ?? itemIdFromLink(entry.itemLink);
  if (!itemId) {
    throw new GargulExportError(`Could not read the item ID from "${entry.itemLink}".`);
  }

  const disenchanted = entry.awardedTo === DISENCHANTED_AWARD;
  const { character, realm } = disenchanted
    ? { character: 'Disenchanted', realm: null }
    : splitPlayerName(entry.awardedTo);

  return {
    checksum: entry.checksum ?? legacyChecksum(entry, itemId),
    awardedAt: entry.timestamp,
    character,
    realm,
    disenchanted,
    itemId,
    itemName: itemNameFromLink(entry.itemLink) ?? `Item ${itemId}`,
    itemLink: entry.itemLink,
    awardedBy: entry.awardedBy ?? null,
    winnerClass: entry.winnerClass ?? null,
    offSpec: isSet(entry.OS),
    softReserved: isSet(entry.SR),
    wishlisted: isSet(entry.WL),
    prioritized: isSet(entry.PL),
    bonusLoot: isSet(entry.isBonusLoot),
    rollType: entry.winningRollType ?? null,
  };
}

function isSet(value) {
  return value === true || value === 1;
}

// Item links look like |cffa335ee|Hitem:19019::::::::60:::::|h[Thunderfury]|h|r
export function itemIdFromLink(itemLink) {
  const match = /\|Hitem:(\d+)/.exec(itemLink);
  return match ? Number(match[1]) : undefined;
}

// Falls back to a bare [Name], in case the link's | codes were lost when the export text was
// copied out of the game.
export function itemNameFromLink(itemLink) {
  return (/\|h\[(.+?)\]\|h/.exec(itemLink) ?? /\[(.+?)\]/.exec(itemLink))?.[1];
}

// Gargul stores winners as "Name-Realm". Character names cannot contain "-", realm names can.
export function splitPlayerName(fullName) {
  const index = fullName.indexOf('-');
  if (index === -1) return { character: fullName, realm: null };
  return { character: fullName.slice(0, index), realm: fullName.slice(index + 1) || null };
}

// Awards recorded by Gargul versions without checksums get a stable ID from their contents, so
// uploading the same export twice still finds them.
function legacyChecksum(entry, itemId) {
  const hash = createHash('sha256')
    .update(`${entry.timestamp}|${itemId}|${entry.awardedTo}`)
    .digest('hex');
  return `${LEGACY_PREFIX}${hash.slice(0, 20)}`;
}
