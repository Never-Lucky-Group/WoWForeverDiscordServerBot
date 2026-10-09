import { splitIntoSessions } from './sessions.js';
import { COMPARED_FIELDS } from './store.js';

// Sessions a single upload may contain: a Discord message holds 5 component rows, one per
// session dropdown plus one for the Import and Cancel buttons.
export const MAX_SESSIONS = 4;

// Works out what importing `awards` (from parseGargulExport) would do, without changing anything:
//   {
//     newSessions,     // [{ startedAt, endedAt, awards, suggestedRaid }] of awards not yet stored
//     newCount,        // awards in newSessions
//     storedCount,     // awards already stored, which will be skipped
//     discrepancies,   // [{ award, stored, differences: [{ label, stored, incoming }] }]
//   }
// When replacing an import, its own awards count as new: they are deleted and stored again.
export function planImport({ store, guildId, awards, raids, replacingImportId }) {
  const stored = store.findAwards(
    guildId,
    awards.map((award) => award.checksum),
  );

  const fresh = [];
  const discrepancies = [];
  let storedCount = 0;
  for (const award of awards) {
    const existing = stored.get(award.checksum);
    if (!existing || existing.importId === replacingImportId) {
      fresh.push(award);
      continue;
    }
    storedCount += 1;
    const differences = compareAward(existing, award);
    if (differences.length > 0) discrepancies.push({ award, stored: existing, differences });
  }

  const newSessions = splitIntoSessions(fresh).map((session) => ({
    ...session,
    suggestedRaid: store.suggestRaid(
      guildId,
      session.awards.map((award) => award.itemId),
      raids,
    ),
  }));

  return { newSessions, newCount: fresh.length, storedCount, discrepancies };
}

// Differences between a stored award row and the same award in a new upload.
export function compareAward(stored, award) {
  const differences = [];
  for (const [field, label] of COMPARED_FIELDS) {
    const storedValue = normalize(stored[field]);
    const incomingValue = normalize(award[field]);
    if (storedValue !== incomingValue) {
      differences.push({ field, label, stored: storedValue, incoming: incomingValue });
    }
  }
  return differences;
}

function normalize(value) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value ?? null;
}
