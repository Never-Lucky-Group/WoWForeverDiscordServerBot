import { Collection, ComponentType } from 'discord.js';
import { vi } from 'vitest';
import { openRaidsDatabase } from '../../src/raids/database.js';
import { loadSetup } from '../../src/raids/setup.js';
import { RaidStore } from '../../src/raids/store.js';
import { GUILD_A, USER_ID, fakeMember } from './fakes.js';

export const RAIDER_ROLE_ID = '700000000000000001';
// A second raid group with its own role and channel.
export const GROUP_B_ROLE_ID = '700000000000000002';
export const GROUP_B_CHANNEL_ID = '720000000000000003';
export const ABSENCE_CHANNEL_ID = '710000000000000001';
export const RAID_CHANNEL_ID = '720000000000000001';
export const OTHER_CHANNEL_ID = '720000000000000002';
export const LEADER_ID = '730000000000000001';
export const API_KEY = 'secret-api-key';

export const MOLTEN_CORE = {
  name: 'Molten Core',
  channelId: RAID_CHANNEL_ID,
  templateId: 'wowclassic',
  leaderId: LEADER_ID,
  weekly: { weekday: 'wednesday', time: '19:30', postAfterHours: 0 },
};
export const ONYXIA = {
  name: 'Onyxia',
  channelId: RAID_CHANNEL_ID,
  templateId: 'wowclassic',
  leaderId: LEADER_ID,
  title: 'Onyxia’s Lair',
};

// The guild's config.json entry. Raid setup lives in the raids database (see raidStore()).
export const RAID_GUILD = { ...GUILD_A };

export const RAID_SETTINGS = {
  absenceChannelId: ABSENCE_CHANNEL_ID,
  raiderRoleId: RAIDER_ROLE_ID,
  timeZone: 'UTC',
  reminderHours: [48, 24],
  memberDms: false,
};

export const seconds = (iso) => Date.parse(iso) / 1000;

export function memoryRaidStore() {
  return new RaidStore(openRaidsDatabase(':memory:'));
}

// A store with GUILD_A's raid setup: `settings` (null for none saved) and `events`.
export function raidStore({ settings = RAID_SETTINGS, events = [MOLTEN_CORE, ONYXIA] } = {}) {
  const store = memoryRaidStore();
  if (settings) store.saveSettings(GUILD_A.id, settings, USER_ID, 0);
  for (const event of events) store.addRaidEvent(GUILD_A.id, event, USER_ID, 0);
  return store;
}

// A stored raid event, with its ID, by name.
export function storedEvent(store, name) {
  return store.raidEvents(GUILD_A.id).find((event) => event.name === name);
}

// GUILD_A's setup from `store`, as the raid features load it.
export function setupOf(store, now = 0) {
  return loadSetup(store, RAID_GUILD, now);
}

// A client with the raid features on for GUILD_A, as index.js sets client.raids up.
export function raidsClient({
  store = raidStore(),
  api = fakeApi(),
  scheduler = { upcomingEvents: () => [], addUpcomingEvent: vi.fn(), refresh: vi.fn() },
  apiKeys = new Map([[GUILD_A.id, API_KEY]]),
} = {}) {
  return { raids: { store, api, scheduler, apiKeys } };
}

// A guild member with a display name who can be DMed. `client` is for canUse() checks, which
// read the raid setup through member.client.
export function raidMember(
  id,
  displayName,
  roleIds = [RAIDER_ROLE_ID],
  { bot = false, client } = {},
) {
  return {
    ...fakeMember(id, roleIds, { bot }),
    displayName,
    client,
    send: vi.fn(() => Promise.resolve()),
  };
}

// A normalized Raid-Helper event (see normalizeEvent()).
export function raidEvent(overrides = {}) {
  return {
    id: '800000000000000001',
    serverId: GUILD_A.id,
    channelId: RAID_CHANNEL_ID,
    leaderId: LEADER_ID,
    title: 'Molten Core',
    startTime: seconds('2026-11-04T19:30:00Z'),
    closeTime: null,
    signUps: [],
    ...overrides,
  };
}

export function signUp(userId, className = 'Warrior') {
  return { userId, name: `User ${userId}`, className, status: 'primary' };
}

// A guild with `members`, an absences channel and a client whose users.fetch() finds `users`.
export function raidGuild(members = [], { absenceChannel = fakeChannel() } = {}) {
  const guild = {
    id: GUILD_A.id,
    name: 'Guild A',
    members: { cache: new Collection(members.map((member) => [member.id, member])) },
    roles: {
      cache: new Collection([
        [RAIDER_ROLE_ID, { id: RAIDER_ROLE_ID, name: 'Raiders' }],
        [GROUP_B_ROLE_ID, { id: GROUP_B_ROLE_ID, name: 'Group B' }],
      ]),
    },
    channels: {
      cache: new Collection(absenceChannel ? [[ABSENCE_CHANNEL_ID, absenceChannel]] : []),
    },
  };
  for (const member of members) member.guild = guild;
  return guild;
}

export function fakeChannel() {
  return { isTextBased: () => true, send: vi.fn(() => Promise.resolve()) };
}

// A fake RaidHelperClient. `events` are returned by listEvents and found by getEvent.
export function fakeApi(events = []) {
  let nextId = 900000000000000001n;
  return {
    events,
    listEvents: vi.fn(async () => events.map((event) => structuredClone(event))),
    getEvent: vi.fn(async (id) => {
      const event = events.find((candidate) => candidate.id === id);
      return event ? structuredClone(event) : null;
    }),
    createEvent: vi.fn(async (serverId, channelId, _apiKey, body) => {
      const event = raidEvent({
        id: String(nextId++),
        serverId,
        channelId,
        leaderId: body.leaderId,
        title: body.title,
        startTime: body.startTime,
      });
      events.push(event);
      return structuredClone(event);
    }),
  };
}

// Options for one subcommand, e.g. 'create' or 'event add' (group and subcommand). Channel, role
// and user options are given as objects such as { id }; `users` maps more user options.
export function raidOptions(subcommand, values = {}, { focused, users = {} } = {}) {
  const all = { ...values, ...users };
  const get = (name, required) => {
    if (all[name] === undefined) {
      if (required) throw new Error(`Missing required option ${name}`);
      return null;
    }
    return all[name];
  };
  const [group, name] = subcommand.includes(' ') ? subcommand.split(' ') : [null, subcommand];
  return {
    getSubcommandGroup: () => group,
    getSubcommand: () => name,
    getString: get,
    getInteger: get,
    getBoolean: get,
    getUser: get,
    getChannel: get,
    getRole: get,
    get: (option) => (all[option] === undefined ? null : { name: option, value: all[option] }),
    getFocused: () => focused,
  };
}

// Reply methods that track replied/deferred like discord.js interactions do.
function replyable(fields) {
  const interaction = {
    replied: false,
    deferred: false,
    responded: false,
    ...fields,
    reply: vi.fn(() => {
      interaction.replied = true;
      return Promise.resolve({ resource: { message: {} } });
    }),
    deferReply: vi.fn(() => {
      interaction.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn(() => {
      interaction.replied = true;
      return Promise.resolve({});
    }),
    followUp: vi.fn(() => Promise.resolve({})),
    respond: vi.fn(() => {
      interaction.responded = true;
      return Promise.resolve();
    }),
  };
  return interaction;
}

// The text input values a modal was filled in with, by custom ID.
export function modalValues(modal) {
  return Object.fromEntries(
    modal.toJSON().components.map(({ component }) => [component.custom_id, component.value ?? '']),
  );
}

// A submitted modal's `fields`: what the modal was filled in with (text, chosen options and
// default users, roles or channels), changed by `changes`. A change is the text for a text
// input, or an array of values or IDs for a select menu; [] chooses nothing. The users in `bots`
// are bots.
export function modalFields(modal, changes = {}, { bots = [] } = {}) {
  const values = {};
  for (const { component } of modal.toJSON().components) {
    const id = component.custom_id;
    if (changes[id] !== undefined) values[id] = changes[id];
    else if (component.type === ComponentType.TextInput) values[id] = component.value ?? '';
    else if (component.type === ComponentType.StringSelect) {
      values[id] = component.options
        .filter((option) => option.default)
        .map((option) => option.value);
    } else values[id] = (component.default_values ?? []).map((value) => value.id);
  }
  const selected = (id, make) =>
    values[id].length ? new Collection(values[id].map((value) => [value, make(value)])) : null;
  return {
    getTextInputValue: (id) => values[id],
    getStringSelectValues: (id) => values[id],
    getSelectedChannels: (id) => selected(id, (value) => ({ id: value })),
    getSelectedRoles: (id) => selected(id, (value) => ({ id: value })),
    getSelectedUsers: (id) => selected(id, (value) => ({ id: value, bot: bots.includes(value) })),
  };
}

// A /raid or /absence interaction from `member` in `guild`, with client.raids set up.
// A modal it shows is submitted with the values it was filled in with, changed by `form`; with
// `form: null` it is never submitted. The submission is returned as `submission()`.
export function raidInteraction({
  commandName = 'raid',
  options,
  guild,
  member,
  store = raidStore(),
  api = fakeApi(),
  scheduler = { upcomingEvents: () => [], addUpcomingEvent: vi.fn(), refresh: vi.fn() },
  apiKeys = new Map([[GUILD_A.id, API_KEY]]),
  guildConfig = RAID_GUILD,
  form = {},
}) {
  const user = { id: member?.id ?? USER_ID };
  const client = raidsClient({ store, api, scheduler, apiKeys });
  if (member) member.client = client;
  let modal;
  let submission;
  const interaction = replyable({
    id: '400000000000000001',
    commandName,
    user,
    client,
    options,
    showModal: vi.fn((shown) => {
      modal = shown;
      interaction.replied = true;
      return Promise.resolve();
    }),
    awaitModalSubmit: vi.fn(async ({ filter }) => {
      if (!modal || form === null) throw new Error('Collector received no interactions');
      const values = { ...modalValues(modal), ...form };
      submission = replyable({
        customId: modal.toJSON().custom_id,
        user,
        fields: { getTextInputValue: (id) => values[id] ?? '' },
      });
      if (!filter(submission)) throw new Error('Collector received no interactions');
      return submission;
    }),
  });
  const context = { guild, member, guildConfig };
  return { interaction, context, store, api, submission: () => submission };
}
