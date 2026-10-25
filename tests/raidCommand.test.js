import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import raid from '../src/commands/raids/raid.js';
import { RaidHelperError } from '../src/raids/apiClient.js';
import { NOT_CONFIGURED_MESSAGE, STORE_UNAVAILABLE_MESSAGE } from '../src/raids/commandContext.js';
import { NO_EVENTS_MESSAGE, RAID_HELPER_ERROR_MESSAGE } from '../src/raids/handlers/raid.js';
import { GUILD_A, GUILD_B, USER_ID } from './helpers/fakes.js';
import { lastMessage } from './helpers/lootInteraction.js';
import {
  API_KEY,
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  LEADER_ID,
  MOLTEN_CORE,
  OTHER_CHANNEL_ID,
  RAIDER_ROLE_ID,
  RAID_CHANNEL_ID,
  RAID_GUILD,
  fakeApi,
  modalValues,
  raidEvent,
  raidGuild,
  raidInteraction,
  raidMember,
  raidOptions,
  raidStore,
  raidsClient,
  seconds,
  signUp,
  storedEvent,
} from './helpers/raids.js';

// Saturday 2026-10-24, midday UTC.
const NOW = Date.parse('2026-10-24T12:00:00Z');
const officer = () => raidMember(USER_ID, 'Officer', [GUILD_A.officerRoleId]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function run(subcommand, values, { member = officer(), members = [], ...rest } = {}) {
  const guild = raidGuild([member, ...members]);
  const setup = raidInteraction({
    options: raidOptions(subcommand, values),
    guild,
    member,
    ...rest,
  });
  await raid.execute(setup.interaction, setup.context);
  return { ...setup, guild, sent: lastMessage(setup.submission() ?? setup.interaction) };
}

describe('/raid definition and permissions', () => {
  it('registers as an Officer command', () => {
    const json = raid.data.toJSON();
    expect(json).toMatchObject({ name: 'raid', default_member_permissions: '0' });
    expect(json.options.map((option) => option.name)).toEqual(['create', 'missing']);
    const create = json.options[0].options;
    expect(create.map((option) => [option.name, option.max_length])).toEqual([
      ['raid', 100],
      ['date', 40],
      ['time', 5],
      ['title', 100],
      ['description', 1000],
    ]);
  });

  it('may be used by Officers in servers with a Raid-Helper API key', () => {
    const member = (roleIds, client = raidsClient()) =>
      raidMember(USER_ID, 'Member', roleIds, { client });
    expect(raid.canUse(member([GUILD_A.officerRoleId]), RAID_GUILD)).toBe(true);
    const noKey = raidsClient({ apiKeys: new Map() });
    expect(raid.canUse(member([GUILD_A.officerRoleId], noKey), RAID_GUILD)).toBe(false);
    expect(raid.canUse(member([RAIDER_ROLE_ID]), RAID_GUILD)).toBe(false);
  });

  it('explains when the feature is unavailable', async () => {
    expect((await run('missing', { event: '1' }, { apiKeys: new Map() })).sent.content).toBe(
      NOT_CONFIGURED_MESSAGE,
    );
    const noStore = raidInteraction({
      options: raidOptions('missing', { event: '1' }),
      guild: raidGuild(),
      member: officer(),
      store: null,
    });
    await raid.execute(noStore.interaction, noStore.context);
    expect(lastMessage(noStore.interaction).content).toBe(STORE_UNAVAILABLE_MESSAGE);
    const noEvents = await run(
      'create',
      { raid: 'Onyxia', date: 'Nov 7' },
      { store: raidStore({ events: [] }) },
    );
    expect(noEvents.sent.content).toBe(NO_EVENTS_MESSAGE);
  });
});

describe('/raid create', () => {
  it('posts the event at its weekly time', async () => {
    const { api, store, sent } = await run('create', { raid: 'molten core', date: 'Nov 4' });

    expect(api.createEvent).toHaveBeenCalledWith(GUILD_A.id, RAID_CHANNEL_ID, API_KEY, {
      leaderId: LEADER_ID,
      templateId: 'wowclassic',
      startTime: seconds('2026-11-04T19:30:00Z'),
      title: 'Molten Core',
      description: undefined,
    });
    expect(sent.content).toContain('Posted **Molten Core**');
    const moltenCore = storedEvent(store, 'Molten Core');
    expect(store.findPostedEvent(GUILD_A.id, moltenCore.id, '2026-11-04')).toMatchObject({
      postedBy: USER_ID,
    });
  });

  it('uses the time option and the configured title', async () => {
    const { api } = await run('create', { raid: 'Onyxia', date: '2026-11-07', time: '20:00' });
    expect(api.createEvent.mock.calls[0][3]).toMatchObject({
      startTime: seconds('2026-11-07T20:00:00Z'),
      title: 'Onyxia’s Lair',
    });
  });

  it("uses the title and description options instead of the event's", async () => {
    const { api, sent, store } = await run('create', {
      raid: 'Onyxia',
      date: 'Nov 7',
      time: '20:00',
      title: ' Ony Alt Run ',
      description: 'Alts welcome\\nPull at 19:45',
    });
    expect(api.createEvent.mock.calls[0][3]).toMatchObject({
      title: 'Ony Alt Run',
      description: 'Alts welcome\nPull at 19:45',
    });
    expect(sent.content).toContain('Posted **Ony Alt Run**');
    // Recorded under the raid event, so the weekly schedule skips that date.
    const onyxia = storedEvent(store, 'Onyxia');
    expect(store.findPostedEvent(GUILD_A.id, onyxia.id, '2026-11-07')).not.toBeNull();
  });

  it("falls back to the event's title and description when the options are blank", async () => {
    const store = raidStore({
      events: [{ ...MOLTEN_CORE, description: 'Bring fire resistance\\nPull at 19:15' }],
    });
    const { api } = await run(
      'create',
      { raid: 'Molten Core', date: 'Nov 4', title: '  ', description: '' },
      { store },
    );
    expect(api.createEvent.mock.calls[0][3]).toMatchObject({
      title: 'Molten Core',
      description: 'Bring fire resistance\nPull at 19:15',
    });
  });

  it('checks for an existing event by the title being posted', async () => {
    const api = fakeApi([raidEvent()]);
    const values = { raid: 'Molten Core', date: 'Nov 4', title: 'MC Alt Run' };
    expect((await run('create', values, { api })).sent.content).toContain('Posted **MC Alt Run**');

    const again = await run('create', { ...values, title: 'mc alt run' }, { api });
    expect(api.createEvent).toHaveBeenCalledTimes(1);
    expect(again.sent.content).toContain(
      `already an event titled **MC Alt Run** in <#${RAID_CHANNEL_ID}>`,
    );
  });

  it('opens a form filled in from config.json', async () => {
    const { interaction } = await run('create', { raid: 'Molten Core', date: 'Nov 4' });
    const modal = interaction.showModal.mock.calls[0][0];
    expect(modal.toJSON().title).toBe('Molten Core · Wed Nov 4, 2026');
    expect(modalValues(modal)).toEqual({ time: '19:30', title: 'Molten Core', description: '' });
  });

  it('fills in the form from the options, with \\n as a new line', async () => {
    const { interaction } = await run('create', {
      raid: 'Onyxia',
      date: 'Nov 7',
      time: '20:00',
      title: 'Ony Alt Run',
      description: 'Alts welcome\\nPull at 19:45',
    });
    expect(modalValues(interaction.showModal.mock.calls[0][0])).toEqual({
      time: '20:00',
      title: 'Ony Alt Run',
      description: 'Alts welcome\nPull at 19:45',
    });
  });

  it('posts what was submitted in the form', async () => {
    const { api, sent } = await run(
      'create',
      { raid: 'Molten Core', date: 'Nov 4' },
      { form: { time: '21:00', title: ' Changed ', description: 'Line one\nLine two' } },
    );
    expect(api.createEvent.mock.calls[0][3]).toMatchObject({
      startTime: seconds('2026-11-04T21:00:00Z'),
      title: 'Changed',
      description: 'Line one\nLine two',
    });
    expect(sent.content).toContain('Posted **Changed**');
  });

  it('uses the config title when the form title is blank', async () => {
    const { api } = await run(
      'create',
      { raid: 'Onyxia', date: 'Nov 7', time: '20:00' },
      { form: { title: '   ' } },
    );
    expect(api.createEvent.mock.calls[0][3].title).toBe('Onyxia’s Lair');
  });

  it('refuses a bad time in the form and shows what was typed', async () => {
    const { api, sent } = await run(
      'create',
      { raid: 'Molten Core', date: 'Nov 4' },
      { form: { time: '7pm', title: 'MC', description: 'Bring pots' } },
    );
    expect(api.createEvent).not.toHaveBeenCalled();
    expect(sent.content).toContain('"7pm" is not a time');
    expect(sent.embeds[0].toJSON().fields).toEqual([
      { name: 'Title', value: 'MC' },
      { name: 'Description', value: 'Bring pots' },
    ]);
  });

  it('does nothing when the form is not submitted', async () => {
    const { api, interaction } = await run(
      'create',
      { raid: 'Molten Core', date: 'Nov 4' },
      { form: null },
    );
    expect(interaction.showModal).toHaveBeenCalledTimes(1);
    expect(api.createEvent).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('refuses a past date before opening the form', async () => {
    const { interaction, sent } = await run('create', { raid: 'Molten Core', date: '2026-10-23' });
    expect(interaction.showModal).not.toHaveBeenCalled();
    expect(sent.content).toContain('has already passed');
  });

  it('lists only that day when checking for an existing event', async () => {
    const { api } = await run('create', { raid: 'Molten Core', date: 'Nov 4' });
    expect(api.listEvents).toHaveBeenCalledWith(GUILD_A.id, API_KEY, {
      startTime: seconds('2026-11-04T00:00:00Z'),
      endTime: seconds('2026-11-05T00:00:00Z') - 1,
    });
  });

  it('adds the new event to the upcoming events for autocomplete', async () => {
    const { interaction, api } = await run('create', { raid: 'Molten Core', date: 'Nov 4' });
    expect(interaction.client.raids.scheduler.addUpcomingEvent).toHaveBeenCalledWith(
      GUILD_A.id,
      expect.objectContaining({ id: api.events[0].id }),
    );
  });

  it('does not take another event at the same time for this one', async () => {
    const api = fakeApi([
      raidEvent({ title: 'Molten Core', startTime: seconds('2026-11-07T20:00:00Z') }),
    ]);
    const { sent } = await run('create', { raid: 'Onyxia', date: 'Nov 7', time: '20:00' }, { api });
    expect(api.createEvent).toHaveBeenCalledTimes(1);
    expect(sent.content).toContain('Posted **Onyxia’s Lair**');
  });

  it('posts once when two posts of the same event run at once', async () => {
    const api = fakeApi();
    let release;
    const created = api.createEvent.getMockImplementation();
    api.createEvent.mockImplementationOnce(
      (...args) => new Promise((resolve) => (release = () => resolve(created(...args)))),
    );
    const values = { raid: 'Molten Core', date: 'Nov 4' };
    const first = run('create', values, { api });
    await vi.waitFor(() => expect(release).toBeDefined());
    const second = run('create', values, { api });
    release();
    const results = await Promise.all([first, second]);

    expect(api.createEvent).toHaveBeenCalledTimes(1);
    expect(results.map(({ sent }) => sent.content.startsWith('Posted'))).toEqual([true, false]);
  });

  it('does not post when the channel already has the event that day', async () => {
    const api = fakeApi([raidEvent()]);
    const { sent } = await run('create', { raid: 'Molten Core', date: 'Nov 4' }, { api });
    expect(api.createEvent).not.toHaveBeenCalled();
    expect(sent.content).toContain('already an event');
  });

  it.each([
    [{ raid: 'Naxxramas', date: 'Nov 4' }, 'no event named'],
    [{ raid: 'Molten Core', date: 'someday' }, 'is not a date'],
    [{ raid: 'Onyxia', date: 'Nov 7' }, 'is not a time'],
    [{ raid: 'Onyxia', date: 'Nov 7', time: '8pm' }, 'is not a time'],
    [{ raid: 'Molten Core', date: 'Oct 24', time: '11:00' }, 'has already passed'],
  ])('refuses %o', async (values, message) => {
    const { api, sent } = await run('create', values);
    expect(sent.content).toContain(message);
    expect(api.createEvent).not.toHaveBeenCalled();
  });

  it('reports a Raid-Helper error without details', async () => {
    const api = fakeApi();
    api.createEvent.mockRejectedValue(
      new RaidHelperError('HTTP 400: bad template', { status: 400 }),
    );
    const { sent } = await run('create', { raid: 'Molten Core', date: 'Nov 4' }, { api });
    expect(sent.content).toBe(RAID_HELPER_ERROR_MESSAGE);
  });
});

describe('/raid missing', () => {
  const raiders = [
    raidMember('1', 'Amy', [RAIDER_ROLE_ID]),
    raidMember('2', 'Bob', [RAIDER_ROLE_ID]),
    raidMember('3', 'Cat', [RAIDER_ROLE_ID]),
  ];

  it('shows who has not signed up, without the absent', async () => {
    const event = raidEvent({ signUps: [signUp('2')] });
    const { sent } = await run(
      'missing',
      { event: event.id },
      { api: fakeApi([event]), members: raiders },
    );
    const embed = sent.embeds[0].toJSON();
    expect(embed.fields[0]).toEqual({ name: 'Not signed up (2)', value: 'Amy, Cat' });
    expect(embed.footer.text).toBe('Checked');
    expect(embed.timestamp).toBe(new Date(NOW).toISOString());
  });

  it('leaves out members with an absence on the event date', async () => {
    const event = raidEvent();
    const api = fakeApi([event]);
    const setup = raidInteraction({
      options: raidOptions('missing', { event: event.id }),
      guild: raidGuild([officer(), ...raiders]),
      member: officer(),
      api,
    });
    setup.store.addAbsence(
      GUILD_A.id,
      {
        userId: '1',
        startsOn: '2026-11-03',
        endsOn: '2026-11-05',
        createdBy: '1',
        source: 'command',
      },
      0,
    );
    await raid.execute(setup.interaction, setup.context);
    const fields = lastMessage(setup.interaction).embeds[0].toJSON().fields;
    expect(fields).toEqual([
      { name: 'Not signed up (2)', value: 'Bob, Cat' },
      { name: 'Absent (1)', value: 'Amy' },
    ]);
  });

  it("checks the roster role of the event's channel", async () => {
    const groupB = {
      ...MOLTEN_CORE,
      name: 'Molten Core B',
      channelId: GROUP_B_CHANNEL_ID,
      raiderRoleId: GROUP_B_ROLE_ID,
    };
    const event = raidEvent({ channelId: GROUP_B_CHANNEL_ID });
    const { sent } = await run(
      'missing',
      { event: event.id },
      {
        api: fakeApi([event]),
        store: raidStore({ events: [MOLTEN_CORE, groupB] }),
        members: [...raiders, raidMember('4', 'Dee', [GROUP_B_ROLE_ID])],
      },
    );
    const embed = sent.embeds[0].toJSON();
    expect(embed.fields).toEqual([{ name: 'Not signed up (1)', value: 'Dee' }]);
    expect(embed.description).toMatch(/^\*\*Guild A\*\*: 1 of 1 member of \*\*Group B\*\* has not/);
  });

  it.each([
    ['another server', raidEvent({ serverId: GUILD_B.id })],
    ['another channel', raidEvent({ channelId: OTHER_CHANNEL_ID })],
  ])('refuses an event in %s', async (_label, event) => {
    const { sent } = await run('missing', { event: event.id }, { api: fakeApi([event]) });
    expect(sent.content).toContain('no such event');
  });

  it('refuses an unknown or malformed event', async () => {
    expect((await run('missing', { event: '123' })).sent.content).toContain('no such event');
    expect((await run('missing', { event: 'abc' })).sent.content).toContain('Choose an event');
  });
});

describe('/raid autocomplete', () => {
  async function suggest(subcommand, focused, values = {}, { events = [] } = {}) {
    const member = officer();
    const setup = raidInteraction({
      options: raidOptions(subcommand, values, { focused }),
      guild: raidGuild([member]),
      member,
      scheduler: { upcomingEvents: () => events },
    });
    await raid.autocomplete(setup.interaction, setup.context);
    return setup.interaction.respond.mock.calls[0][0];
  }

  it("suggests only sheets in the setup's channels for /raid missing", async () => {
    const events = [
      raidEvent(),
      raidEvent({ id: '800000000000000002', channelId: OTHER_CHANNEL_ID, title: 'Gone' }),
    ];
    const choices = await suggest('missing', { name: 'event', value: '' }, {}, { events });
    expect(choices.map((choice) => choice.value)).toEqual([events[0].id]);
  });

  it('suggests configured events', async () => {
    expect(await suggest('create', { name: 'raid', value: 'ony' })).toEqual([
      { name: 'Onyxia', value: 'Onyxia' },
    ]);
  });

  it("suggests the chosen event's weekly dates, and spells out typed dates", async () => {
    const choices = await suggest('create', { name: 'date', value: '' }, { raid: 'Molten Core' });
    expect(choices.slice(0, 2)).toEqual([
      { name: 'Wed Oct 28, 2026 – Molten Core', value: '2026-10-28' },
      { name: 'Wed Nov 4, 2026 – Molten Core', value: '2026-11-04' },
    ]);
    expect(choices).toHaveLength(4);

    expect(
      await suggest('create', { name: 'date', value: '11/4' }, { raid: 'Molten Core' }),
    ).toEqual([
      { name: 'Wed Nov 4, 2026', value: '2026-11-04' },
      { name: 'Wed Nov 4, 2026 – Molten Core', value: '2026-11-04' },
    ]);
  });

  it('suggests upcoming events from the last fetch', async () => {
    const event = raidEvent();
    expect(
      await suggest('missing', { name: 'event', value: 'molten' }, {}, { events: [event] }),
    ).toEqual([{ name: 'Wed Nov 4, 2026 19:30 – Molten Core', value: event.id }]);
  });
});
