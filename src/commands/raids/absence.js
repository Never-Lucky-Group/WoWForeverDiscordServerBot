import { createMemberCommand } from '../../lib/command.js';
import { isOfficer } from '../../lib/membership.js';
import { sendPrivate } from '../../loot/discord/privateReply.js';
import { AUTOCOMPLETE_LIMIT, dateChoices, choiceName } from '../../raids/autocomplete.js';
import { canUseAbsences, raidsContext } from '../../raids/commandContext.js';
import { formatDateRange, parseDateInput, todayIn } from '../../raids/dates.js';
import { addAbsence, cancelAbsence, listAbsences } from '../../raids/handlers/absence.js';

const REASON_MAX_LENGTH = 200;

const data = createMemberCommand('absence', 'Tell the officers when you will miss raids.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Record that you will miss the raids on one or more days.')
      .addStringOption((option) =>
        option
          .setName('from')
          .setDescription('First day away, e.g. 2026-11-04, Nov 4 or 11/4')
          .setMaxLength(40)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('to')
          .setDescription('Last day away (default: the same day as from)')
          .setMaxLength(40)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('reason')
          .setDescription('Why, shown in the absences channel')
          .setMaxLength(REASON_MAX_LENGTH),
      )
      .addUserOption((option) =>
        option.setName('member').setDescription('Officers only: add it for this member'),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List upcoming absences.')
      .addUserOption((option) =>
        option
          .setName('member')
          .setDescription("Officers only: this member's absences (default: everyone's)"),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('cancel')
      .setDescription('Cancel an absence.')
      .addIntegerOption((option) =>
        option
          .setName('id')
          .setDescription('The absence to cancel')
          .setMinValue(1)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

const help = {
  description:
    "Records the days you will miss raids, so you are not reported as missing from the events' " +
    'sign-ups on those days. New absences are posted in the absences channel.\n\n' +
    'Dates autocomplete with upcoming event dates, and may be typed as 2026-11-04, Nov 4, ' +
    'November 4th or 11/4 (month first); without a year the next such date is used. ' +
    'Replies are visible only to you.',
  examples: [
    { usage: '/absence add from:Nov 4', description: 'Miss the raids on November 4.' },
    {
      usage: '/absence add from:Nov 4 to:Nov 11 reason:Holiday',
      description: 'Miss every raid from November 4 to 11.',
    },
    { usage: '/absence list', description: 'Your upcoming absences.' },
  ],
  subcommands: {
    add: {
      description:
        'Records an absence from `from` to `to`, both included, of at most 90 days. Leave out ' +
        '`to` for a single day; a `to` without a year is the next such date after `from`. The ' +
        'absence is posted in the absences channel with its reason.\n\n' +
        'Officers can add an absence for another member with `member`.',
      examples: [
        { usage: '/absence add from:Nov 4', description: 'Miss the raids on November 4.' },
        {
          usage: '/absence add from:11/20 to:11/27 reason:Travelling',
          description: 'Miss every raid from November 20 to 27.',
        },
      ],
    },
    list: {
      description:
        'Lists absences that have not ended yet, with their numbers. You see your own; ' +
        "Officers see everyone's, or one member's with `member`.",
      examples: [{ usage: '/absence list', description: 'List upcoming absences.' }],
    },
    cancel: {
      description:
        'Cancels an absence by its number, for example when your plans change. You can cancel ' +
        "your own; Officers can cancel anyone's. Nothing is posted in the absences channel.",
      examples: [{ usage: '/absence cancel id:12', description: 'Cancel absence #12.' }],
    },
  },
};

const handlers = {
  add: addAbsence,
  list: listAbsences,
  cancel: cancelAbsence,
};

export default {
  data,
  help,

  // Raiders and Officers, in servers with the raid features on.
  canUse: canUseAbsences,

  async execute(interaction, context) {
    const { error, context: raidCtx } = raidsContext(interaction, context);
    if (error) {
      await sendPrivate(interaction, { content: error });
      return;
    }
    const subcommand = interaction.options.getSubcommand();
    const handler = handlers[subcommand];
    if (!handler) throw new Error(`Unknown /absence subcommand "${subcommand}"`);
    await handler(interaction, raidCtx);
  },

  async autocomplete(interaction, context) {
    const { error, context: raidCtx } = raidsContext(interaction, context);
    if (error) {
      await interaction.respond([]);
      return;
    }
    await interaction.respond(suggest(interaction, raidCtx).slice(0, AUTOCOMPLETE_LIMIT));
  },
};

// Autocomplete choices for the focused option.
function suggest(interaction, { guild, member, guildConfig, setup, store, scheduler, timeZone }) {
  const focused = interaction.options.getFocused(true);
  const text = String(focused.value);
  const now = Date.now();
  const dateOptions = {
    text,
    timeZone,
    now,
    events: scheduler?.upcomingEvents(guild.id) ?? [],
    eventConfigs: setup.events,
  };

  switch (focused.name) {
    case 'from':
      return dateChoices(dateOptions);

    case 'to': {
      const fromText = interaction.options.getString('from');
      const from = fromText ? parseDateInput(fromText, timeZone, now) : null;
      return dateChoices({ ...dateOptions, minDate: from });
    }

    case 'id': {
      const officer = isOfficer(member, guildConfig);
      const lowerText = text.trim().toLowerCase();
      return store
        .upcomingAbsences(guild.id, todayIn(timeZone, now), officer ? null : member.id)
        .map((absence) => {
          const who = guild.members.cache.get(absence.userId)?.displayName ?? absence.userId;
          return {
            name: choiceName(
              `#${absence.id} · ${formatDateRange(absence.startsOn, absence.endsOn)}` +
                (officer ? ` · ${who}` : ''),
            ),
            value: absence.id,
          };
        })
        .filter((choice) => choice.name.toLowerCase().includes(lowerText));
    }

    default:
      return [];
  }
}
