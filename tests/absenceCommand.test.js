import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import absence from '../src/commands/raids/absence.js';
import { NO_PERMISSION_MESSAGE } from '../src/handlers/commandInteraction.js';
import { NO_ABSENCE_CHANNEL_MESSAGE } from '../src/raids/handlers/absence.js';
import { GUILD_A, USER_ID } from './helpers/fakes.js';
import { lastMessage } from './helpers/lootInteraction.js';
import {
  ABSENCE_CHANNEL_ID,
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  MOLTEN_CORE,
  RAIDER_ROLE_ID,
  RAID_GUILD,
  RAID_SETTINGS,
  fakeChannel,
  memoryRaidStore,
  raidEvent,
  raidGuild,
  raidInteraction,
  raidMember,
  raidOptions,
  raidStore,
  raidsClient,
} from './helpers/raids.js';

// Saturday 2026-10-24, midday UTC.
const NOW = Date.parse('2026-10-24T12:00:00Z');
const OTHER_ID = '300000000000000002';
const raider = (id = USER_ID, name = 'Amy') => raidMember(id, name, [RAIDER_ROLE_ID]);
const officer = () => raidMember(USER_ID, 'Officer', [GUILD_A.officerRoleId]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function run(
  subcommand,
  values,
  {
    member = raider(),
    members = [raider(OTHER_ID, 'Bob')],
    users,
    store,
    channel = fakeChannel(),
  } = {},
) {
  const guild = raidGuild([member, ...members], { absenceChannel: channel });
  const setup = raidInteraction({
    commandName: 'absence',
    options: raidOptions(subcommand, values, { users }),
    guild,
    member,
    store,
  });
  await absence.execute(setup.interaction, setup.context);
  return { ...setup, channel, sent: lastMessage(setup.interaction) };
}

describe('/absence definition and permissions', () => {
  it('registers as a command every member can see', () => {
    const json = absence.data.toJSON();
    expect(json.name).toBe('absence');
    expect(json.default_member_permissions).toBeUndefined();
    expect(json.options.map((option) => option.name)).toEqual(['add', 'list', 'cancel']);
  });

  const member = (roleIds, client = raidsClient()) =>
    raidMember(USER_ID, 'Member', roleIds, { client });

  it('may be used by raiders and Officers in servers with a Raid-Helper API key', () => {
    expect(absence.canUse(member([RAIDER_ROLE_ID]), RAID_GUILD)).toBe(true);
    expect(absence.canUse(member([GUILD_A.officerRoleId]), RAID_GUILD)).toBe(true);
    expect(absence.canUse(member([]), RAID_GUILD)).toBe(false);
    const noKey = raidsClient({ apiKeys: new Map() });
    expect(absence.canUse(member([RAIDER_ROLE_ID], noKey), RAID_GUILD)).toBe(false);
  });

  it("may be used by members with only an event's roster role", () => {
    const groupB = { ...MOLTEN_CORE, channelId: GROUP_B_CHANNEL_ID, raiderRoleId: GROUP_B_ROLE_ID };
    const withGroupB = raidsClient({ store: raidStore({ events: [groupB] }) });
    expect(absence.canUse(member([GROUP_B_ROLE_ID], withGroupB), RAID_GUILD)).toBe(true);
    expect(absence.canUse(member([GROUP_B_ROLE_ID]), RAID_GUILD)).toBe(false);
  });

  it('refuses to record absences until the absences channel is set', async () => {
    const store = raidStore({ settings: { ...RAID_SETTINGS, absenceChannelId: null } });
    const { sent } = await run('add', { from: 'Nov 4' }, { store });
    expect(sent.content).toBe(NO_ABSENCE_CHANNEL_MESSAGE);
    expect(store.upcomingAbsences(GUILD_A.id, '2026-10-24')).toEqual([]);
  });
});

describe('/absence add', () => {
  it('records a one-day absence and posts it without pinging', async () => {
    const { store, channel, sent } = await run('add', { from: 'Nov 4', reason: 'Work' });

    expect(store.getAbsence(GUILD_A.id, 1)).toMatchObject({
      userId: USER_ID,
      startsOn: '2026-11-04',
      endsOn: '2026-11-04',
      reason: 'Work',
      createdBy: USER_ID,
      source: 'command',
    });
    expect(channel.send).toHaveBeenCalledWith({
      content: `**Absence #1**: <@${USER_ID}> · Wed Nov 4, 2026 · Work`,
      allowedMentions: { parse: [] },
    });
    expect(sent.content).toContain('Recorded your absence #1: **Wed Nov 4, 2026**.');
  });

  it('records a range', async () => {
    const { store } = await run('add', { from: '11/20', to: '11/27' });
    expect(store.getAbsence(GUILD_A.id, 1)).toMatchObject({
      startsOn: '2026-11-20',
      endsOn: '2026-11-27',
      reason: null,
    });
  });

  it('reads a `to` without a year as the next such date after `from`', async () => {
    const { store } = await run('add', { from: '2026-12-28', to: 'Jan 3' });
    expect(store.getAbsence(GUILD_A.id, 1)).toMatchObject({
      startsOn: '2026-12-28',
      endsOn: '2027-01-03',
    });
  });

  it('accepts an absence of exactly 90 days', async () => {
    const { store } = await run('add', { from: 'Nov 4', to: '2027-02-01' });
    expect(store.getAbsence(GUILD_A.id, 1)).toMatchObject({ endsOn: '2027-02-01' });
  });

  it('accepts an absence that started before today but has not ended', async () => {
    const { store } = await run('add', { from: '2026-10-20', to: 'Oct 25' });
    expect(store.getAbsence(GUILD_A.id, 1)).not.toBeNull();
  });

  it.each([
    [{ from: 'whenever' }, 'is not a date'],
    [{ from: 'Nov 4', to: 'never' }, 'is not a date'],
    [{ from: '2026-11-06', to: '2026-11-04' }, 'must not be before'],
    [{ from: 'Oct 24', to: 'Oct 23' }, 'at most 90 days long'],
    [{ from: 'Nov 4', to: '2027-02-02' }, 'at most 90 days long'],
    [{ from: '2026-10-01', to: '2026-10-23' }, 'already over'],
    [{ from: '2027-10-25' }, 'at most 365 days'],
  ])('refuses %o', async (values, message) => {
    const { store, channel, sent } = await run('add', values);
    expect(sent.content).toContain(message);
    expect(store.getAbsence(GUILD_A.id, 1)).toBeNull();
    expect(channel.send).not.toHaveBeenCalled();
  });

  it('lets Officers add an absence for another member', async () => {
    const { store, channel, sent } = await run(
      'add',
      { from: 'Nov 4' },
      { member: officer(), users: { member: { id: OTHER_ID } } },
    );
    expect(store.getAbsence(GUILD_A.id, 1)).toMatchObject({ userId: OTHER_ID, createdBy: USER_ID });
    expect(channel.send.mock.calls[0][0].content).toContain(`(added by <@${USER_ID}>)`);
    expect(sent.content).toContain(`<@${OTHER_ID}>'s absence #1`);
  });

  it('does not let raiders add an absence for someone else', async () => {
    const { store, sent } = await run(
      'add',
      { from: 'Nov 4' },
      { users: { member: { id: OTHER_ID } } },
    );
    expect(sent.content).toContain('Only Officers');
    expect(store.getAbsence(GUILD_A.id, 1)).toBeNull();
  });

  it('refuses a member who is not in the server', async () => {
    const { sent } = await run(
      'add',
      { from: 'Nov 4' },
      { member: officer(), members: [], users: { member: { id: OTHER_ID } } },
    );
    expect(sent.content).toContain('is not a member');
  });

  it('keeps the absence when it cannot be posted', async () => {
    const channel = fakeChannel();
    channel.send.mockRejectedValue(new Error('Missing Access'));
    const { store, sent } = await run('add', { from: 'Nov 4' }, { channel });
    expect(store.getAbsence(GUILD_A.id, 1)).not.toBeNull();
    expect(sent.content).toContain(`could not be posted in <#${ABSENCE_CHANNEL_ID}>`);

    const missing = await run('add', { from: 'Nov 4' }, { channel: null });
    expect(missing.sent.content).toContain('could not be posted');
  });
});

describe('/absence list and cancel', () => {
  function storeWithAbsences() {
    const store = memoryRaidStore();
    const add = (userId, startsOn, endsOn) =>
      store.addAbsence(
        GUILD_A.id,
        { userId, startsOn, endsOn, createdBy: userId, source: 'command' },
        0,
      );
    add(USER_ID, '2026-11-04', '2026-11-04');
    add(OTHER_ID, '2026-11-05', '2026-11-06');
    add(USER_ID, '2026-10-01', '2026-10-02');
    return store;
  }

  it('shows raiders their own upcoming absences', async () => {
    const { sent } = await run('list', {}, { store: storeWithAbsences() });
    expect(sent.embeds[0].toJSON().description).toBe(`**#1** · <@${USER_ID}> · Wed Nov 4, 2026`);
  });

  it("shows Officers everyone's, or one member's", async () => {
    const all = await run('list', {}, { member: officer(), store: storeWithAbsences() });
    expect(all.sent.embeds[0].toJSON().description.split('\n')).toHaveLength(2);

    const one = await run(
      'list',
      {},
      { member: officer(), store: storeWithAbsences(), users: { member: { id: OTHER_ID } } },
    );
    expect(one.sent.embeds[0].toJSON().description).toContain('#2');
    expect(one.sent.embeds[0].toJSON().description).not.toContain('#1');
  });

  it("does not show raiders someone else's absences", async () => {
    const { sent } = await run(
      'list',
      {},
      { store: storeWithAbsences(), users: { member: { id: OTHER_ID } } },
    );
    expect(sent.content).toBe(NO_PERMISSION_MESSAGE);
  });

  it('says when there are none', async () => {
    const { sent } = await run('list', {});
    expect(sent.embeds[0].toJSON().description).toBe('No upcoming absences.');
  });

  it('lets raiders cancel only their own absences', async () => {
    const store = storeWithAbsences();
    const own = await run('cancel', { id: 1 }, { store });
    expect(own.sent.content).toBe('Cancelled absence #1 (Wed Nov 4, 2026).');
    expect(store.getAbsence(GUILD_A.id, 1)).toBeNull();

    const other = await run('cancel', { id: 2 }, { store });
    expect(other.sent.content).toBe('There is no absence #2 that you can cancel.');
    expect(store.getAbsence(GUILD_A.id, 2)).not.toBeNull();
  });

  it("lets Officers cancel anyone's absence", async () => {
    const store = storeWithAbsences();
    const { sent, channel } = await run('cancel', { id: 2 }, { member: officer(), store });
    expect(sent.content).toContain(`for <@${OTHER_ID}>`);
    expect(store.getAbsence(GUILD_A.id, 2)).toBeNull();
    expect(channel.send).not.toHaveBeenCalled();
  });
});

describe('/absence autocomplete', () => {
  async function suggest(
    subcommand,
    focused,
    values = {},
    { member = raider(), store, events = [] } = {},
  ) {
    const setup = raidInteraction({
      commandName: 'absence',
      options: raidOptions(subcommand, values, { focused }),
      guild: raidGuild([member, raider(OTHER_ID, 'Bob')]),
      member,
      store,
      scheduler: { upcomingEvents: () => events },
    });
    await absence.autocomplete(setup.interaction, setup.context);
    return setup.interaction.respond.mock.calls[0][0];
  }

  it('suggests upcoming event dates from the fetched events and the weekly schedule', async () => {
    const choices = await suggest(
      'add',
      { name: 'from', value: '' },
      {},
      {
        events: [
          raidEvent({ title: 'Onyxia', startTime: Date.parse('2026-10-31T20:00:00Z') / 1000 }),
        ],
      },
    );
    expect(choices.slice(0, 3)).toEqual([
      { name: 'Wed Oct 28, 2026 – Molten Core', value: '2026-10-28' },
      { name: 'Sat Oct 31, 2026 – Onyxia', value: '2026-10-31' },
      { name: 'Wed Nov 4, 2026 – Molten Core', value: '2026-11-04' },
    ]);
  });

  it('spells out a typed date first', async () => {
    expect(await suggest('add', { name: 'from', value: 'november 4th' })).toEqual([
      { name: 'Wed Nov 4, 2026', value: '2026-11-04' },
      { name: 'Wed Nov 4, 2026 – Molten Core', value: '2026-11-04' },
    ]);
  });

  it('only suggests `to` dates on or after `from`', async () => {
    const choices = await suggest('add', { name: 'to', value: '' }, { from: 'Nov 4' });
    expect(choices[0]).toEqual({ name: 'Wed Nov 4, 2026 – Molten Core', value: '2026-11-04' });
    expect(await suggest('add', { name: 'to', value: 'Jan 3' }, { from: 'Dec 28' })).toEqual([
      { name: 'Sun Jan 3, 2027', value: '2027-01-03' },
    ]);
  });

  it('suggests cancellable absences: own for raiders, everyone for Officers', async () => {
    const store = memoryRaidStore();
    store.addAbsence(
      GUILD_A.id,
      {
        userId: USER_ID,
        startsOn: '2026-11-04',
        endsOn: '2026-11-04',
        createdBy: USER_ID,
        source: 'command',
      },
      0,
    );
    store.addAbsence(
      GUILD_A.id,
      {
        userId: OTHER_ID,
        startsOn: '2026-11-05',
        endsOn: '2026-11-05',
        createdBy: OTHER_ID,
        source: 'command',
      },
      0,
    );
    expect(await suggest('cancel', { name: 'id', value: '' }, {}, { store })).toEqual([
      { name: '#1 · Wed Nov 4, 2026', value: 1 },
    ]);
    expect(
      await suggest('cancel', { name: 'id', value: 'bob' }, {}, { store, member: officer() }),
    ).toEqual([{ name: '#2 · Thu Nov 5, 2026 · Bob', value: 2 }]);
  });
});
