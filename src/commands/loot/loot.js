import { NO_PERMISSION_MESSAGE } from '../../handlers/commandInteraction.js';
import { createOfficerCommand } from '../../lib/command.js';
import { hasLootRole } from '../../lib/membership.js';
import { sendPrivate } from '../../loot/discord/privateReply.js';
import { importExport } from '../../loot/handlers/importExport.js';
import { deleteImport, listImports } from '../../loot/handlers/manageImports.js';
import {
  characterQuery,
  itemQuery,
  leaderboardQuery,
  raidQuery,
} from '../../loot/handlers/queries.js';
import { DEFAULT_RAID_RESET, localDate } from '../../loot/raidWeeks.js';
import { AWARD_TYPES } from '../../loot/store.js';

export const NOT_CONFIGURED_MESSAGE =
  'The loot commands are not set up for this server: add a `lootRoleId` for it in config.json.';
export const STORE_UNAVAILABLE_MESSAGE =
  'The loot database is unavailable, so the loot commands are disabled. Check the bot logs.';

const AUTOCOMPLETE_LIMIT = 25;

// Filter options shared by the query subcommands.
function addFilterOptions(subcommand, { withType = true } = {}) {
  subcommand
    .addIntegerOption((option) =>
      option
        .setName('weeks')
        .setDescription('Only the last N raid weeks (1 = since the most recent reset)')
        .setMinValue(1)
        .setMaxValue(520),
    )
    .addStringOption((option) =>
      option
        .setName('raid')
        .setDescription('Only this raid')
        .setMaxLength(100)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option.setName('from').setDescription('Only from this date (YYYY-MM-DD)').setMaxLength(10),
    )
    .addStringOption((option) =>
      option
        .setName('to')
        .setDescription('Only up to and including this date (YYYY-MM-DD)')
        .setMaxLength(10),
    );
  if (withType) {
    subcommand.addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Only awards of this type')
        .addChoices(
          Object.entries(AWARD_TYPES).map(([value, { label }]) => ({ name: label, value })),
        ),
    );
  }
  return subcommand;
}

const data = createOfficerCommand('loot', 'Import Gargul loot exports and look up who got what.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('import')
      .setDescription('Import a Gargul "Detailed (JSON)" loot export.')
      .addAttachmentOption((option) =>
        option.setName('file').setDescription('The Gargul JSON export').setRequired(true),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('imports')
      .setDescription('Manage uploaded Gargul exports.')
      .addSubcommand((subcommand) =>
        subcommand.setName('list').setDescription('List uploaded Gargul exports.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('delete')
          .setDescription('Delete an upload and all of its awards.')
          .addIntegerOption((option) =>
            option
              .setName('id')
              .setDescription('The import to delete')
              .setRequired(true)
              .setAutocomplete(true),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('replace')
          .setDescription("Replace an upload's awards with a corrected Gargul export.")
          .addIntegerOption((option) =>
            option
              .setName('id')
              .setDescription('The import to replace')
              .setRequired(true)
              .setAutocomplete(true),
          )
          .addAttachmentOption((option) =>
            option
              .setName('file')
              .setDescription('The corrected Gargul JSON export')
              .setRequired(true),
          ),
      ),
  )
  .addSubcommand((subcommand) =>
    addFilterOptions(
      subcommand
        .setName('character')
        .setDescription('Items a character received.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Character name, optionally with -Realm')
            .setMaxLength(100)
            .setRequired(true)
            .setAutocomplete(true),
        ),
    ),
  )
  .addSubcommand((subcommand) =>
    addFilterOptions(
      subcommand
        .setName('item')
        .setDescription('Who received an item.')
        .addStringOption((option) =>
          option
            .setName('name')
            .setDescription('Item name or ID')
            .setMaxLength(100)
            .setRequired(true)
            .setAutocomplete(true),
        ),
      { withType: false },
    ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('raid')
      .setDescription('Everything awarded in one raid session.')
      .addStringOption((option) =>
        option
          .setName('session')
          .setDescription('The raid session')
          .setMaxLength(20)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((subcommand) =>
    addFilterOptions(
      subcommand.setName('leaderboard').setDescription('Characters ranked by items received.'),
    ),
  );

const handlers = {
  import: (interaction, context) => importExport(interaction, context),
  'imports list': listImports,
  'imports delete': deleteImport,
  'imports replace': (interaction, context) =>
    importExport(interaction, context, interaction.options.getInteger('id', true)),
  character: characterQuery,
  item: itemQuery,
  raid: raidQuery,
  leaderboard: leaderboardQuery,
};

// Returns the context loot handlers need, or a message explaining why the user cannot use them.
function lootContext(interaction, context) {
  const store = interaction.client.lootStore;
  if (!store) return { error: STORE_UNAVAILABLE_MESSAGE };
  if (!context.guildConfig.lootRoleId) return { error: NOT_CONFIGURED_MESSAGE };
  if (!hasLootRole(context.member, context.guildConfig)) return { error: NO_PERMISSION_MESSAGE };
  return { context: { ...context, store } };
}

function subcommandKey(options) {
  const group = options.getSubcommandGroup(false);
  const subcommand = options.getSubcommand();
  return group ? `${group} ${subcommand}` : subcommand;
}

export default {
  data,

  async execute(interaction, context) {
    const { error, context: lootCtx } = lootContext(interaction, context);
    if (error) {
      await sendPrivate(interaction, { content: error });
      return;
    }
    const handler = handlers[subcommandKey(interaction.options)];
    if (!handler)
      throw new Error(`Unknown /loot subcommand "${subcommandKey(interaction.options)}"`);
    await handler(interaction, lootCtx);
  },

  async autocomplete(interaction, context) {
    const { error, context: lootCtx } = lootContext(interaction, context);
    if (error) {
      await interaction.respond([]);
      return;
    }
    await interaction.respond(suggest(interaction, lootCtx).slice(0, AUTOCOMPLETE_LIMIT));
  },
};

// Autocomplete choices for the focused option.
function suggest(interaction, { guild, guildConfig, store }) {
  const focused = interaction.options.getFocused(true);
  const text = String(focused.value).trim();
  const lowerText = text.toLowerCase();

  switch (focused.name) {
    case 'raid':
      return (guildConfig.raids ?? [])
        .filter((raid) => raid.toLowerCase().includes(lowerText))
        .map((raid) => ({ name: raid, value: raid }));

    case 'name':
      if (interaction.options.getSubcommand() === 'item') {
        return store.searchItems(guild.id, text).map(({ itemId, itemName }) => ({
          name: truncate(`${itemName} (${itemId})`),
          value: String(itemId),
        }));
      }
      return store
        .searchCharacters(guild.id, text)
        .map((name) => ({ name: truncate(name), value: name }));

    case 'session': {
      const timeZone = (guildConfig.raidReset ?? DEFAULT_RAID_RESET).timeZone;
      return store
        .recentSessions(guild.id)
        .map((session) => ({
          name: truncate(
            `${localDate(session.startedAt, timeZone)} ${session.raid} · ` +
              `${session.awardCount} items · import #${session.importId}`,
          ),
          value: String(session.id),
        }))
        .filter((choice) => choice.name.toLowerCase().includes(lowerText))
        .slice(0, AUTOCOMPLETE_LIMIT);
    }

    case 'id': {
      const timeZone = (guildConfig.raidReset ?? DEFAULT_RAID_RESET).timeZone;
      return store
        .listImports(guild.id)
        .map((entry) => {
          const raids = [...new Set(entry.sessions.map((session) => session.raid))].join(', ');
          const date = entry.sessions[0]
            ? localDate(entry.sessions[0].startedAt, timeZone)
            : 'empty';
          return {
            name: truncate(`#${entry.id} · ${date} · ${raids} · ${entry.awardCount} items`),
            value: entry.id,
          };
        })
        .filter((choice) => choice.name.toLowerCase().includes(lowerText))
        .slice(0, AUTOCOMPLETE_LIMIT);
    }

    default:
      return [];
  }
}

// Autocomplete choice names are limited to 100 characters.
function truncate(text) {
  return text.length > 100 ? `${text.slice(0, 99)}…` : text;
}
