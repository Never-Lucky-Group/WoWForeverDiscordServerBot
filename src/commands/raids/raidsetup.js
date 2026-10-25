import { WEEKDAYS } from '../../config.js';
import { createOfficerCommand } from '../../lib/command.js';
import { sendPrivate } from '../../loot/discord/privateReply.js';
import { AUTOCOMPLETE_LIMIT, choiceName } from '../../raids/autocomplete.js';
import { canUseRaidCommands, raidsContext } from '../../raids/commandContext.js';
import { RAID_CHANNEL_TYPES, openPanel } from '../../raids/handlers/panel.js';
import {
  addEvent,
  editEvent,
  listEvents,
  removeEvent,
  setSettings,
  showSettings,
} from '../../raids/handlers/setup.js';
import { MAX_EVENTS, POST_AFTER_HOURS, postAfterText } from '../../raids/setup.js';

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);
const POST_AFTER_CHOICES = POST_AFTER_HOURS.map((hours) => ({
  name: capitalize(postAfterText(hours)),
  value: hours,
}));
const WEEKDAY_CHOICES = WEEKDAYS.map((weekday) => ({ name: capitalize(weekday), value: weekday }));

// The options /raidsetup event add requires and edit makes optional, in Discord's order: required
// options must come first.
function addEventOptions(subcommand, { required }) {
  return subcommand
    .addStringOption((option) =>
      option
        .setName('name')
        .setDescription('Shown in /raid create, and the title unless `title` is set')
        .setMaxLength(100)
        .setRequired(required),
    )
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The sign-up channel Raid-Helper posts it in')
        .addChannelTypes(...RAID_CHANNEL_TYPES)
        .setRequired(required),
    )
    .addStringOption((option) =>
      option
        .setName('template')
        .setDescription("A built-in Raid-Helper template ID, e.g. one used on this server's events")
        .setMaxLength(50)
        .setRequired(required)
        .setAutocomplete(true),
    )
    .addUserOption((option) =>
      option
        .setName('leader')
        .setDescription('The event leader, who gets the missing sign-ups reports')
        .setRequired(required),
    );
}

function addOptionalEventOptions(subcommand) {
  return subcommand
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Members expected to sign up (default: the shared roster role)'),
    )
    .addStringOption((option) =>
      option
        .setName('title')
        .setDescription(
          'Event title (default: the name); {date} and {day} become e.g. 11/4 and Tue',
        )
        .setMaxLength(100),
    )
    .addStringOption((option) =>
      option
        .setName('description')
        .setDescription('Event description; \\n is a new line')
        .setMaxLength(1000),
    )
    .addStringOption((option) =>
      option
        .setName('weekday')
        .setDescription('Post it automatically every week for this day (with `time`)')
        .addChoices(...WEEKDAY_CHOICES),
    )
    .addStringOption((option) =>
      option
        .setName('time')
        .setDescription('Weekly 24-hour start time, e.g. 19:30, in the raid time zone')
        .setMaxLength(5),
    )
    .addIntegerOption((option) =>
      option
        .setName('post-after')
        .setDescription("When to post it, after last week's raid starts (default: when it starts)")
        .addChoices(...POST_AFTER_CHOICES),
    );
}

const eventOption = (option) =>
  option
    .setName('event')
    .setDescription('The raid event')
    .setMaxLength(100)
    .setRequired(true)
    .setAutocomplete(true);

const data = createOfficerCommand('raidsetup', 'Set up the raid events and raid settings.')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('panel')
      .setDescription('Set up raids with buttons and forms: the easiest way to start.'),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('event')
      .setDescription('The kinds of raid the bot posts.')
      .addSubcommand((subcommand) =>
        addOptionalEventOptions(
          addEventOptions(subcommand.setName('add').setDescription('Add a raid event.'), {
            required: true,
          }),
        ),
      )
      .addSubcommand((subcommand) =>
        addOptionalEventOptions(
          addEventOptions(
            subcommand
              .setName('edit')
              .setDescription('Change a raid event: only the options you give change.')
              .addStringOption(eventOption),
            { required: false },
          ),
        ).addStringOption((option) =>
          option
            .setName('clear')
            .setDescription('Remove an optional field')
            .addChoices(
              { name: 'Title', value: 'title' },
              { name: 'Description', value: 'description' },
              { name: 'Roster role (use the shared one)', value: 'role' },
              { name: 'Weekly time (post only with /raid create)', value: 'weekly' },
            ),
        ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('remove')
          .setDescription('Remove a raid event.')
          .addStringOption(eventOption),
      )
      .addSubcommand((subcommand) =>
        subcommand.setName('list').setDescription('List the raid events.'),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName('settings')
      .setDescription('Settings for every raid event in this server.')
      .addSubcommand((subcommand) =>
        subcommand.setName('show').setDescription('Show the raid settings.'),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName('set')
          .setDescription('Change raid settings: only the options you give change.')
          .addChannelOption((option) =>
            option
              .setName('absence-channel')
              .setDescription('Where /absence add posts new absences')
              .addChannelTypes(...RAID_CHANNEL_TYPES),
          )
          .addRoleOption((option) =>
            option
              .setName('roster-role')
              .setDescription('Members expected to sign up for events without their own role'),
          )
          .addStringOption((option) =>
            option
              .setName('time-zone')
              .setDescription('Time zone for raid times and dates, e.g. America/New_York')
              .setMaxLength(64)
              .setAutocomplete(true),
          )
          .addStringOption((option) =>
            option
              .setName('reminder-hours')
              .setDescription('Hours before each event to report missing sign-ups, e.g. 48, 24')
              .setMaxLength(40),
          )
          .addBooleanOption((option) =>
            option.setName('member-dms').setDescription('Also DM each member who is missing'),
          )
          .addStringOption((option) =>
            option
              .setName('clear')
              .setDescription('Unset a setting')
              .addChoices(
                { name: 'Absences channel', value: 'absence-channel' },
                { name: 'Shared roster role', value: 'roster-role' },
                { name: 'Time zone (use the raid reset one)', value: 'time-zone' },
              ),
          ),
      ),
  );

const help = {
  description:
    'Sets up the raid sign-up features: the kinds of raid the bot posts through ' +
    '[Raid-Helper](https://raid-helper.xyz) (`event`), and the settings for all of them ' +
    '(`settings`). `panel` does both with buttons and forms, and is the easiest way to start. ' +
    'Changes take effect at once and are logged.\n\n' +
    'Each event has a channel, a template, a leader and a roster role, and optionally a weekly ' +
    'time at which the bot posts it by itself. Everyone with the roster role is expected to ' +
    "sign up for every event in that event's channel. Events in one channel share a roster " +
    'role, so separate raid groups need their own channels. A raid run twice a week is two ' +
    'events; they may share a title.\n\n' +
    'Replies are visible only to you.',
  examples: [
    { usage: '/raidsetup panel', description: 'Set up raids with buttons and forms.' },
    {
      usage:
        '/raidsetup event add name:Molten Core channel:#20-man template:wowforever ' +
        'leader:@Booth weekday:Wednesday time:19:00',
      description: "Post Molten Core every week, when the previous Wednesday's raid starts.",
    },
    {
      usage: '/raidsetup settings set absence-channel:#absences roster-role:@Raiders',
      description: 'Set where absences are posted and who is expected to sign up.',
    },
  ],
  subcommands: {
    panel: {
      description:
        'Shows the raid settings and events in a private panel. Its buttons open short forms ' +
        'with pickers for channels, roles and people, filled in with the current values; empty ' +
        'a field to clear it, or choose Not weekly to stop posting an event every week. Choose an event to change or remove it.\n\n' +
        'A new event takes two forms: the basics (name, channel, template, leader, roster role), ' +
        'then the weekly time, title and description. It is saved only when the second form is ' +
        'submitted.\n\n' +
        'The panel closes after 14 minutes without a click; run the command again to reopen it. ' +
        'The time zone list holds the common ones; set any other with `/raidsetup settings set`.',
    },
    'event add': {
      description:
        `Adds a raid event; a server can have up to ${MAX_EVENTS}. \`template\` suggests the ` +
        "templates of this server's events; run `/raid create` once afterwards to check that " +
        'Raid-Helper accepts it.\n\n' +
        'In `title`, `{date}` becomes the raid date (e.g. 11/4) and `{day}` its weekday (e.g. ' +
        'Tue), so `Molten Core {date}` gives each week its own title.\n\n' +
        'Without `role`, the shared roster role from `/raidsetup settings` is used. With ' +
        '`weekday` and `time`, the bot posts the event every week; without them, only ' +
        "`/raid create` posts it. `post-after` sets when: by default when the previous week's " +
        'raid starts, or up to 6 days after it, for example once that raid is over. A sheet ' +
        'that is already due is posted within a few seconds.',
      examples: [
        {
          usage:
            '/raidsetup event add name:Onyxia channel:#40-man template:wowforever leader:@Booth',
          description: 'An event posted only with /raid create.',
        },
      ],
    },
    'event edit': {
      description:
        'Changes the options you give and keeps the rest. `clear` removes the title, the ' +
        'description, its own roster role or the weekly time.\n\n' +
        'Sheets already posted are not moved or retitled; change them in Raid-Helper. Moving ' +
        'an event to another channel keeps checking its sheets already posted in the old one ' +
        'until they start.',
      examples: [
        {
          usage: '/raidsetup event edit event:Molten Core weekday:Thursday',
          description: 'Post Molten Core on Thursdays from now on.',
        },
        {
          usage:
            '/raidsetup event edit event:Molten Core post-after:3 hours after the previous raid starts',
          description: "Post next week's sheet 3 hours after this week's raid starts.",
        },
        {
          usage: '/raidsetup event edit event:Onyxia clear:Weekly time',
          description: 'Stop posting Onyxia every week.',
        },
      ],
    },
    'event remove': {
      description:
        'Removes an event: it is no longer posted or offered in `/raid create`. Sheets already ' +
        'posted in its channel stay in Raid-Helper and keep their reminders until they start.',
      examples: [{ usage: '/raidsetup event remove event:Onyxia', description: 'Remove Onyxia.' }],
    },
    'event list': {
      description: 'Lists every raid event with its channel, template, leader, roster and times.',
    },
    'settings show': {
      description: 'Shows the raid settings.',
    },
    'settings set': {
      description:
        'Changes the settings you give and keeps the rest:\n' +
        '- `absence-channel`: where `/absence add` posts. Absences cannot be recorded until it ' +
        'is set.\n' +
        '- `roster-role`: members expected to sign up for events without a role of their own.\n' +
        "- `time-zone`: the time zone raid times and dates are read in; default the raid reset's.\n" +
        '- `reminder-hours`: when event leaders get reports of missing sign-ups, e.g. `48, 24` ' +
        '(up to 5, from 1 to 168), or `none`. A report also goes out when sign-ups close.\n' +
        '- `member-dms`: also DM each missing member, with buttons to answer.\n\n' +
        'Members see `/absence` only once their roster role is added under Server Settings → ' +
        'Integrations → this bot → /absence.',
      examples: [
        {
          usage: '/raidsetup settings set time-zone:America/Los_Angeles reminder-hours:72, 24',
          description: 'Read raid times in Pacific time; report 72 and 24 hours before.',
        },
      ],
    },
  },
};

const handlers = {
  panel: openPanel,
  'event add': addEvent,
  'event edit': editEvent,
  'event remove': removeEvent,
  'event list': listEvents,
  'settings show': showSettings,
  'settings set': setSettings,
};

export default {
  data,
  help,

  // Officers, in servers with the raid features on.
  canUse: canUseRaidCommands,

  async execute(interaction, context) {
    const { error, context: raidCtx } = raidsContext(interaction, context);
    if (error) {
      await sendPrivate(interaction, { content: error });
      return;
    }
    const group = interaction.options.getSubcommandGroup();
    const subcommand = interaction.options.getSubcommand();
    const path = group ? `${group} ${subcommand}` : subcommand;
    const handler = handlers[path];
    if (!handler) throw new Error(`Unknown /raidsetup subcommand "${path}"`);
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
function suggest(interaction, { guild, setup, scheduler }) {
  const focused = interaction.options.getFocused(true);
  const text = String(focused.value).trim();
  const lowerText = text.toLowerCase();

  switch (focused.name) {
    case 'event':
      return setup.events
        .filter((event) => event.name.toLowerCase().includes(lowerText))
        .map((event) => ({ name: choiceName(event.name), value: String(event.id) }));

    case 'template': {
      // Raid-Helper cannot list its templates, so offer those this server already uses.
      const used = new Set(
        [
          ...(scheduler?.upcomingEvents(guild.id) ?? []).map((event) => event.templateId),
          ...setup.events.map((event) => event.templateId),
        ].filter(Boolean),
      );
      const matches = [...used].filter((id) => id.toLowerCase().includes(lowerText)).sort();
      const typed = text && !matches.includes(text) ? [text] : [];
      return [...typed, ...matches].map((id) => ({ name: choiceName(id), value: id }));
    }

    case 'time-zone': {
      const query = lowerText.replace(/\s+/g, '_');
      return timeZones()
        .filter((zone) => zone.toLowerCase().includes(query))
        .map((zone) => ({ name: zone, value: zone }));
    }

    default:
      return [];
  }
}

let zones;
function timeZones() {
  zones ??= [...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')])];
  return zones;
}
