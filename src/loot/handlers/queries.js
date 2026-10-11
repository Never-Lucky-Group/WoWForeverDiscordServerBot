import { toCsv, isoTime } from '../csv.js';
import { sendPaged } from '../discord/pager.js';
import { sendPrivate } from '../discord/privateReply.js';
import { FilterError, readFilters } from '../filters.js';
import { awardLines, characterName, sessionSpan } from '../format.js';

const AWARD_CSV_COLUMNS = [
  { header: 'awarded_at', value: (award) => isoTime(award.awardedAt) },
  { header: 'character', value: (award) => award.character },
  { header: 'realm', value: (award) => award.realm },
  { header: 'item_id', value: (award) => award.itemId },
  { header: 'item', value: (award) => award.itemName },
  { header: 'raid', value: (award) => award.raid },
  { header: 'session_id', value: (award) => award.sessionId },
  { header: 'import_id', value: (award) => award.importId },
  { header: 'disenchanted', value: (award) => award.disenchanted },
  { header: 'off_spec', value: (award) => award.offSpec },
  { header: 'soft_reserved', value: (award) => award.softReserved },
  { header: 'wishlisted', value: (award) => award.wishlisted },
  { header: 'prioritized', value: (award) => award.prioritized },
  { header: 'bonus_roll', value: (award) => award.bonusLoot },
  { header: 'roll_type', value: (award) => award.rollType },
  { header: 'gargul_id', value: (award) => award.checksum },
];

// Runs a query that takes filters, replying with the FilterError message if they are invalid.
async function withFilters(interaction, guildConfig, run) {
  let parsed;
  try {
    parsed = readFilters(interaction.options, guildConfig);
  } catch (error) {
    if (!(error instanceof FilterError)) throw error;
    await sendPrivate(interaction, { content: error.message });
    return;
  }
  await run(parsed);
}

// /loot character
export async function characterQuery(interaction, { guild, guildConfig, store }) {
  const name = interaction.options.getString('name', true).trim();
  await withFilters(interaction, guildConfig, async ({ filters, description }) => {
    const awards = store.characterAwards(guild.id, name, filters);
    const count = `${awards.length} item${awards.length === 1 ? '' : 's'}`;
    // Show the name as Gargul stored it, unless the name matched characters on several realms.
    const storedNames = new Set(awards.map(characterName));
    const shownName = storedNames.size === 1 ? [...storedNames][0] : name;
    await sendPaged(interaction, {
      header: `**${shownName}** received **${count}**${description}.`,
      lines: awards.map(awardLines.forCharacter),
      emptyText: 'No awards found. Check the spelling; names autocomplete from imported loot.',
      csv: {
        fileName: `loot-${fileSafe(name)}.csv`,
        build: () => toCsv(AWARD_CSV_COLUMNS, awards),
      },
    });
  });
}

// /loot item
export async function itemQuery(interaction, { guild, guildConfig, store }) {
  const item = interaction.options.getString('name', true).trim();
  await withFilters(interaction, guildConfig, async ({ filters, description }) => {
    const awards = store.itemAwards(guild.id, item, filters);
    // Autocomplete passes the item ID; show the name even when the filters match nothing.
    const itemName = awards[0]?.itemName ?? store.itemName(guild.id, item) ?? item;
    const times = `${awards.length} time${awards.length === 1 ? '' : 's'}`;
    await sendPaged(interaction, {
      header: `**${itemName}** was awarded **${times}**${description}.`,
      lines: awards.map(awardLines.forItem),
      emptyText: 'No awards found. Item names autocomplete from imported loot.',
      csv: {
        fileName: `item-${fileSafe(itemName)}.csv`,
        build: () => toCsv(AWARD_CSV_COLUMNS, awards),
      },
    });
  });
}

// /loot raid
export async function raidQuery(interaction, { guild, store }) {
  const value = interaction.options.getString('session', true).trim();
  const session = /^\d+$/.test(value) ? store.getSession(guild.id, Number(value)) : null;
  if (!session) {
    await sendPrivate(interaction, {
      content: 'Raid session not found. Pick one from the list that appears as you type.',
    });
    return;
  }
  const awards = store.sessionAwards(guild.id, session.id);
  await sendPaged(interaction, {
    header:
      `**${session.raid}** · ${sessionSpan(session)} · **${awards.length}** ` +
      `item${awards.length === 1 ? '' : 's'} (import #${session.importId})`,
    lines: awards.map(awardLines.forSession),
    emptyText: 'This session has no awards.',
    csv: {
      fileName: `raid-${session.id}-${fileSafe(session.raid)}.csv`,
      build: () => toCsv(AWARD_CSV_COLUMNS, awards),
    },
  });
}

// /loot leaderboard
export async function leaderboardQuery(interaction, { guild, guildConfig, store }) {
  await withFilters(interaction, guildConfig, async ({ filters, description }) => {
    const rows = store.leaderboard(guild.id, filters).map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
    await sendPaged(interaction, {
      header: `**Loot leaderboard**${description}:`,
      lines: rows.map(
        (row) =>
          `${row.rank}. **${characterName(row)}** · ${row.count} item${row.count === 1 ? '' : 's'}`,
      ),
      emptyText: 'No awards found.',
      csv: {
        fileName: 'loot-leaderboard.csv',
        build: () =>
          toCsv(
            [
              { header: 'rank', value: (row) => row.rank },
              { header: 'character', value: (row) => row.character },
              { header: 'realm', value: (row) => row.realm },
              { header: 'items', value: (row) => row.count },
            ],
            rows,
          ),
      },
    });
  });
}

function fileSafe(text) {
  return text.replace(/[^\w-]+/g, '_').slice(0, 50) || 'loot';
}
