import { NO_PERMISSION_MESSAGE } from '../../handlers/commandInteraction.js';
import { createOfficerCommand } from '../../lib/command.js';
import { hasLootRole, isOfficer } from '../../lib/membership.js';
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

// The /help text for the options addFilterOptions() adds.
function filtersHelp({ withType = true } = {}) {
  return (
    'Filters: `weeks` (the last N raid weeks; 1 means since the most recent reset), `raid`, ' +
    '`from`/`to` (YYYY-MM-DD, `to` inclusive; not together with `weeks`)' +
    (withType ? ' and `type`.' : '.')
  );
}

const help = {
  description:
    "Stores the raid's [Gargul](https://github.com/papa-smurf/Gargul) loot history so you can " +
    "look up who received what. Upload Gargul's **Detailed (JSON)** export with " +
    '`/loot import`, then look up awards by character, item, raid session or leaderboard.\n\n' +
    'The character, item and leaderboard lookups take filters; see their pages for details. ' +
    'Character names, items, raids, sessions and upload numbers autocomplete.\n\n' +
    'Replies are visible only to you. Long results have **Previous**/**Next** buttons, and ' +
    '**Download CSV** sends the full result as a file. The buttons stop working after 10 minutes.',
  examples: [
    { usage: '/loot import file:<export.json>', description: 'Import a Gargul export.' },
    {
      usage: '/loot character name:Thrall weeks:4',
      description: 'Items Thrall received in the last 4 raid weeks.',
    },
    { usage: '/loot leaderboard weeks:1', description: 'Who received the most items this week.' },
  ],
  subcommands: {
    import: {
      description:
        "Imports a Gargul **Detailed (JSON)** export. In Gargul's settings, set **Exporting " +
        'loot** to Detailed (JSON), run `/gl export`, select the raid days and save all of the ' +
        'text in a .json file.\n\n' +
        'Awards already stored are skipped, so overlapping exports and exports from several ' +
        'Officers are safe. If a stored award differs from the file, for example because its ' +
        'winner was changed in Gargul, the bot lists the difference and changes nothing: fix it ' +
        'with `/loot imports replace` or `/loot imports delete`.\n\n' +
        'New awards are split into raid sessions (a gap of 6 hours or more starts a new one; at ' +
        "most 4 per file). Choose each session's raid, then press **Import**. Nothing is stored " +
        'if you cancel, wait more than 5 minutes, or the bot restarts first.',
      examples: [
        { usage: '/loot import file:<export.json>', description: 'Import a Gargul export.' },
      ],
    },
    imports: {
      description: 'List, delete or replace uploaded Gargul exports.',
    },
    'imports list': {
      description:
        'Lists every upload with its number, raid sessions and award count. ' +
        '`/loot imports delete` and `/loot imports replace` take the upload number.',
      examples: [{ usage: '/loot imports list', description: 'List the uploads.' }],
    },
    'imports delete': {
      description: 'Deletes an upload and every award it added, after asking you to confirm.',
      examples: [{ usage: '/loot imports delete id:3', description: 'Delete upload #3.' }],
    },
    'imports replace': {
      description:
        "Replaces an upload's awards with a corrected Gargul export; the upload keeps its " +
        'number. Use it when awards were changed or deleted in Gargul after the import: a later ' +
        'import never removes an award that is missing from the new file.',
      examples: [
        {
          usage: '/loot imports replace id:3 file:<export.json>',
          description: 'Replace the awards of upload #3.',
        },
      ],
    },
    character: {
      description:
        'Lists the items a character received. Names match without regard to case, with or ' +
        `without -Realm. Items given to the disenchanter are not counted.\n\n${filtersHelp()}`,
      examples: [
        { usage: '/loot character name:Thrall', description: 'Every item Thrall received.' },
        {
          usage: '/loot character name:Thrall weeks:1 type:Main spec',
          description: 'Main spec items Thrall received since the most recent reset.',
        },
      ],
    },
    item: {
      description:
        'Lists who received an item, by item name or ID. Items given to the disenchanter are ' +
        `not counted.\n\n${filtersHelp({ withType: false })}`,
      examples: [
        {
          usage: '/loot item name:<item> from:2026-11-01 to:2026-11-30',
          description: 'Who received the item in November 2026.',
        },
      ],
    },
    raid: {
      description:
        'Lists everything awarded in one raid session, including items given to the ' +
        'disenchanter. Sessions autocomplete with their date, raid and item count.',
      examples: [
        { usage: '/loot raid session:<session>', description: 'Everything awarded that night.' },
      ],
    },
    leaderboard: {
      description:
        'Ranks characters by the number of items received. Items given to the disenchanter ' +
        `are not counted.\n\n${filtersHelp()}`,
      examples: [
        {
          usage: '/loot leaderboard weeks:4 type:Main spec',
          description: 'Who received the most main spec items in the last 4 raid weeks.',
        },
      ],
    },
  },
};

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
  help,

  // Officers with the loot role. In a server without a loot role, Officers may still run /loot so
  // it can tell them it is not set up.
  canUse(member, guildConfig) {
    return (
      isOfficer(member, guildConfig) &&
      (!guildConfig.lootRoleId || hasLootRole(member, guildConfig))
    );
  },

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
