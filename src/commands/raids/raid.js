import { createOfficerCommand } from '../../lib/command.js';
import { sendPrivate } from '../../loot/discord/privateReply.js';
import {
  AUTOCOMPLETE_LIMIT,
  dateChoices,
  eventChoices,
  choiceName,
} from '../../raids/autocomplete.js';
import { canUseRaidCommands, raidsContext } from '../../raids/commandContext.js';
import { createRaid, missingForEvent } from '../../raids/handlers/raid.js';
import { raidChannelIds } from '../../raids/schedule.js';

const data = createOfficerCommand('raid', 'Post Raid-Helper sign-up sheets and see who is missing.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('create')
      .setDescription('Post a Raid-Helper sign-up sheet for a raid event, through a form.')
      .addStringOption((option) =>
        option
          .setName('raid')
          .setDescription('The event to post')
          .setMaxLength(100)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('date')
          .setDescription('The date, e.g. 2026-11-04, Nov 4 or 11/4')
          .setMaxLength(40)
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName('time')
          .setDescription(
            "Fills in the form's 24-hour start time, e.g. 19:30 (default: weekly time)",
          )
          .setMaxLength(5),
      )
      .addStringOption((option) =>
        option
          .setName('title')
          .setDescription("Fills in the form's title (default: the event's title)")
          .setMaxLength(100),
      )
      .addStringOption((option) =>
        option
          .setName('description')
          .setDescription(
            "Fills in the form's description; \\n is a new line (default: the event's)",
          )
          .setMaxLength(1000),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('missing')
      .setDescription('Who has not signed up for an event yet.')
      .addStringOption((option) =>
        option
          .setName('event')
          .setDescription('The event')
          .setMaxLength(20)
          .setRequired(true)
          .setAutocomplete(true),
      ),
  );

const help = {
  description:
    'Posts [Raid-Helper](https://raid-helper.xyz) sign-up sheets and checks who has not signed ' +
    "up. Everyone with a raid channel's roster role is expected to sign up for every event in " +
    'that channel, unless they have an absence for its date (see `/absence`). Any sign-up counts, ' +
    'including Tentative, Late, Bench and Absence.\n\n' +
    'The bot also posts the weekly events by itself, and DMs the event leader a report of ' +
    'missing sign-ups before each event and when Raid-Helper closes sign-ups. Officers set the ' +
    'events up with `/raidsetup`.\n\n' +
    'Replies are visible only to you.',
  examples: [
    {
      usage: '/raid create raid:Molten Core date:Nov 4',
      description: 'Post the Molten Core sign-up sheet for November 4, through a form.',
    },
    { usage: '/raid missing event:<event>', description: 'Who has not signed up for an event.' },
  ],
  subcommands: {
    create: {
      description:
        "Posts a sign-up sheet in the event's channel, with its template and leader (see " +
        '`/raidsetup event list`). Dates autocomplete with the weekly event dates, and may be ' +
        'typed as 2026-11-04, Nov 4, November 4th or 11/4 (month first); without a year the ' +
        'next such date is used.\n\n' +
        'A form then opens with the start time, title and description, filled in with the ' +
        "options or, without them, the event's weekly time, title and description. Change what " +
        'you need and press Submit to post. The description box ' +
        'takes several lines. The form must be submitted within 15 minutes.\n\n' +
        'To change one week of a weekly event, post it early with its own title or description; ' +
        'the weekly schedule then skips that date.\n\n' +
        'Nothing is posted if the channel already has an event with the same title that day.',
      examples: [
        {
          usage: '/raid create raid:Molten Core date:Nov 4',
          description: 'Open the form for Molten Core on November 4, at its weekly time.',
        },
        {
          usage: '/raid create raid:Onyxia date:2026-11-07 time:20:00',
          description: 'Open the form for Onyxia on November 7, with 20:00 filled in.',
        },
        {
          usage: '/raid create raid:Molten Core date:Nov 11 title:MC Alt Run',
          description: 'Open the form for Molten Core with its own title filled in.',
        },
      ],
    },
    missing: {
      description:
        "Lists the members of the event channel's roster role who have not signed up, those " +
        'signed up only as Tentative, those with an absence for its date, and those signed up ' +
        'despite an absence. Events autocomplete with the upcoming events in the raid channels.',
      examples: [
        { usage: '/raid missing event:<event>', description: 'Who has not signed up yet.' },
      ],
    },
  },
};

const handlers = {
  create: createRaid,
  missing: missingForEvent,
};

export default {
  data,
  help,

  // Officers, in servers with the raid features on.
  canUse: canUseRaidCommands,

  async execute(interaction, context) {
    const subcommand = interaction.options.getSubcommand();
    const { error, context: raidCtx } = raidsContext(interaction, context);
    if (error) {
      await sendPrivate(interaction, { content: error });
      return;
    }
    const handler = handlers[subcommand];
    if (!handler) throw new Error(`Unknown /raid subcommand "${subcommand}"`);
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
function suggest(interaction, { guild, setup, scheduler, timeZone }) {
  const focused = interaction.options.getFocused(true);
  const text = String(focused.value);
  const events = scheduler?.upcomingEvents(guild.id) ?? [];

  switch (focused.name) {
    case 'raid': {
      const lowerText = text.trim().toLowerCase();
      return setup.events
        .filter((event) => event.name.toLowerCase().includes(lowerText))
        .map((event) => ({ name: choiceName(event.name), value: event.name }));
    }

    case 'date': {
      // Only the chosen event's weekly dates, once one is chosen.
      const name = interaction.options.getString('raid')?.trim().toLowerCase();
      const chosen = setup.events.filter((event) => event.name.toLowerCase() === name);
      return dateChoices({
        text,
        timeZone,
        now: Date.now(),
        events: [],
        eventConfigs: chosen.length ? chosen : setup.events,
      });
    }

    case 'event': {
      // The loop's last fetch may still hold sheets of a channel the setup no longer uses.
      const channelIds = raidChannelIds(setup);
      return eventChoices({
        text,
        timeZone,
        events: events.filter((event) => channelIds.has(event.channelId)),
      });
    }

    default:
      return [];
  }
}
