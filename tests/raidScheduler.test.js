import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { RaidHelperError } from '../src/raids/apiClient.js';
import { LOOKAHEAD_SECONDS, RaidScheduler } from '../src/raids/scheduler.js';
import { GUILD_A, makeBotConfig } from './helpers/fakes.js';
import {
  API_KEY,
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  LEADER_ID,
  MOLTEN_CORE,
  ONYXIA,
  OTHER_CHANNEL_ID,
  RAID_GUILD,
  RAID_SETTINGS,
  fakeApi,
  raidEvent,
  raidGuild,
  raidMember,
  raidStore,
  seconds,
  signUp,
  storedEvent,
} from './helpers/raids.js';

const HOUR = 60 * 60;
const EVENT_START = seconds('2026-11-04T19:30:00Z');

// The default raid setup with Molten Core's weekly time changed (undefined for none).
function withWeekly(weekly) {
  return { events: [{ ...MOLTEN_CORE, weekly }, ONYXIA] };
}

// A scheduler over one guild with three raiders. `events` are Raid-Helper's; `raidSetup` is the
// raid setup in the store (see raidStore()). `clock.now` (Unix seconds) can be moved.
function setup({
  events = [raidEvent()],
  raidSetup = {},
  members = [raidMember('1', 'Amy'), raidMember('2', 'Bob'), raidMember('3', 'Cat')],
  now = EVENT_START - 72 * HOUR,
  apiKeys = new Map([[GUILD_A.id, API_KEY]]),
} = {}) {
  const guild = raidGuild(members);
  const leader = { id: LEADER_ID, send: vi.fn(() => Promise.resolve()) };
  const client = {
    botConfig: makeBotConfig(RAID_GUILD),
    guilds: { cache: new Collection([[guild.id, guild]]) },
    users: { fetch: vi.fn(async () => leader) },
  };
  const store = raidStore(raidSetup);
  const api = fakeApi(events);
  const clock = { now };
  const scheduler = new RaidScheduler({
    client,
    store,
    api,
    apiKeys,
    now: () => clock.now * 1000,
  });
  return { scheduler, store, api, guild, leader, clock, members, client };
}

function reportFields(leader, call = 0) {
  return leader.send.mock.calls[call][0].embeds[0].toJSON().fields;
}

describe('RaidScheduler reminders', () => {
  it('reports missing sign-ups to the leader at a reminder point', async () => {
    const { scheduler, leader, clock, api } = setup();
    api.events[0].signUps = [signUp('2'), signUp('3', 'Tentative')];

    await scheduler.tick(); // first seen, 72h before
    expect(leader.send).not.toHaveBeenCalled();

    clock.now = EVENT_START - 48 * HOUR + 60;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(1);
    expect(reportFields(leader)).toEqual([
      { name: 'Not signed up (1)', value: 'Amy' },
      { name: 'Tentative (1)', value: 'Cat' },
    ]);
    expect(leader.send.mock.calls[0][0].embeds[0].toJSON().footer.text).toBe(
      '48-hour reminder · Run /raid missing for an update · Next report: 24 hours before the event',
    );
    expect(leader.send.mock.calls[0][0].embeds[0].toJSON().timestamp).toBe(
      new Date(clock.now * 1000).toISOString(),
    );
  });

  it('sends each point once and the next point later', async () => {
    const { scheduler, leader, clock } = setup();
    await scheduler.tick();
    clock.now = EVENT_START - 48 * HOUR + 60;
    await scheduler.tick();
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(1);

    clock.now = EVENT_START - 24 * HOUR + 60;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(2);
  });

  it('sends only the latest point after downtime', async () => {
    const { scheduler, leader, clock } = setup();
    await scheduler.tick();
    clock.now = EVENT_START - 12 * HOUR;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(1);
    expect(leader.send.mock.calls[0][0].embeds[0].toJSON().footer.text).toMatch(
      /^24-hour reminder/,
    );
  });

  it('does not report straight away on an event first seen after a point', async () => {
    const { scheduler, leader, clock } = setup({ now: EVENT_START - 30 * HOUR });
    await scheduler.tick();
    expect(leader.send).not.toHaveBeenCalled();
    clock.now = EVENT_START - 24 * HOUR;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(1);
  });

  it('reports again when Raid-Helper closes sign-ups', async () => {
    const closeTime = EVENT_START - 6 * HOUR;
    const { scheduler, leader, clock } = setup({ events: [raidEvent({ closeTime })] });
    await scheduler.tick();
    clock.now = EVENT_START - 24 * HOUR;
    await scheduler.tick();
    clock.now = closeTime;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(2);
    expect(leader.send.mock.calls[1][0].embeds[0].toJSON().footer.text).toContain('closed');
  });

  it('sends nothing when nobody is missing, and leaves out absent members', async () => {
    const { scheduler, store, leader, clock, api } = setup();
    api.events[0].signUps = [signUp('1'), signUp('2')];
    store.addAbsence(
      GUILD_A.id,
      {
        userId: '3',
        startsOn: '2026-11-04',
        endsOn: '2026-11-04',
        createdBy: '3',
        source: 'command',
      },
      clock.now,
    );
    await scheduler.tick();
    clock.now = EVENT_START - 48 * HOUR;
    await scheduler.tick();
    expect(leader.send).not.toHaveBeenCalled();
    expect(store.sentReminderPoints(GUILD_A.id, api.events[0].id, EVENT_START)).toEqual(
      new Set(['48h']),
    );
  });

  it('fires the reminders again when an event is moved', async () => {
    const { scheduler, leader, clock, api } = setup();
    await scheduler.tick();
    clock.now = EVENT_START - 24 * HOUR;
    await scheduler.tick();
    api.events[0].startTime = EVENT_START + 24 * HOUR;
    clock.now = EVENT_START;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(2);
  });

  it('reports a sign-up despite an absence even when nobody is missing', async () => {
    const { scheduler, store, leader, clock, api } = setup();
    api.events[0].signUps = [signUp('1'), signUp('2'), signUp('3')];
    store.addAbsence(
      GUILD_A.id,
      {
        userId: '3',
        startsOn: '2026-11-04',
        endsOn: '2026-11-04',
        createdBy: '3',
        source: 'command',
      },
      clock.now,
    );
    await scheduler.tick();
    clock.now = EVENT_START - 48 * HOUR;
    await scheduler.tick();
    expect(reportFields(leader)).toEqual([
      { name: 'Not signed up (0)', value: 'Everyone has signed up.' },
      { name: 'Signed up, but has an absence (1)', value: 'Cat' },
    ]);
  });

  it("checks the roster role of the event's channel", async () => {
    const groupB = {
      ...MOLTEN_CORE,
      name: 'Molten Core B',
      channelId: GROUP_B_CHANNEL_ID,
      raiderRoleId: GROUP_B_ROLE_ID,
      weekly: undefined,
    };
    const { scheduler, leader, clock } = setup({
      events: [raidEvent({ channelId: GROUP_B_CHANNEL_ID })],
      raidSetup: { events: [groupB] },
      members: [raidMember('1', 'Amy'), raidMember('4', 'Dee', [GROUP_B_ROLE_ID])],
    });

    await scheduler.tick();
    clock.now = EVENT_START - 48 * HOUR + 60;
    await scheduler.tick();
    expect(reportFields(leader)).toEqual([{ name: 'Not signed up (1)', value: 'Dee' }]);
    expect(leader.send.mock.calls[0][0].embeds[0].toJSON().description).toMatch(
      /^You lead this event in \*\*Guild A\*\*\. 1 of 1 member of \*\*Group B\*\* has not/,
    );
  });

  it('keeps reminding sheets in a channel watched after its event was removed', async () => {
    const { scheduler, store, leader, clock } = setup({
      events: [raidEvent({ channelId: OTHER_CHANNEL_ID })],
      raidSetup: { events: [] },
    });
    store.watchChannel(GUILD_A.id, {
      channelId: OTHER_CHANNEL_ID,
      eventName: 'Old raid',
      watchUntil: EVENT_START,
    });
    await scheduler.tick();
    clock.now = EVENT_START - 24 * HOUR;
    await scheduler.tick();
    expect(reportFields(leader)[0]).toEqual({ name: 'Not signed up (3)', value: 'Amy, Bob, Cat' });
  });

  it('ignores events in other channels', async () => {
    const { scheduler, leader, clock } = setup({
      events: [raidEvent({ channelId: OTHER_CHANNEL_ID })],
      raidSetup: withWeekly(undefined),
    });
    await scheduler.tick();
    clock.now = EVENT_START - 24 * HOUR;
    await scheduler.tick();
    expect(leader.send).not.toHaveBeenCalled();
    expect(scheduler.upcomingEvents(GUILD_A.id)).toEqual([]);
  });

  it('keeps going when the leader cannot be DMed', async () => {
    const { scheduler, leader, clock, store, api } = setup();
    leader.send.mockRejectedValue(new Error('Cannot send messages to this user'));
    await scheduler.tick();
    clock.now = EVENT_START - 24 * HOUR;
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(store.sentReminderPoints(GUILD_A.id, api.events[0].id, EVENT_START).size).toBe(1);
  });

  it('DMs missing members once when memberDms is on, and lists them in the report', async () => {
    const { scheduler, leader, clock, members } = setup({
      raidSetup: { settings: { ...RAID_SETTINGS, memberDms: true } },
    });
    members[1].send.mockRejectedValue(new Error('DMs closed'));
    await scheduler.tick();
    clock.now = EVENT_START - 48 * HOUR;
    await scheduler.tick();

    expect(members[0].send).toHaveBeenCalledTimes(1);
    expect(members[0].send.mock.calls[0][0].components[0].toJSON().components).toHaveLength(2);
    expect(reportFields(leader).map((field) => field.name)).toEqual([
      'Not signed up (3)',
      'DMed (2)',
      'Could not DM (1)',
    ]);

    clock.now = EVENT_START - 24 * HOUR;
    await scheduler.tick();
    expect(members[0].send).toHaveBeenCalledTimes(1);
    // A member whose DM failed is tried again.
    expect(members[1].send).toHaveBeenCalledTimes(2);
  });

  it('does not DM members while memberDms is off', async () => {
    const { scheduler, clock, members } = setup();
    await scheduler.tick();
    clock.now = EVENT_START - 48 * HOUR;
    await scheduler.tick();
    for (const member of members) expect(member.send).not.toHaveBeenCalled();
  });
});

describe('RaidScheduler weekly posts', () => {
  // Molten Core is weekly on Wednesday 19:30 UTC, posted when the previous raid starts.
  it('posts a weekly event once it is due, only once', async () => {
    const { scheduler, api, clock, store } = setup({
      events: [],
      now: EVENT_START - 7 * 24 * HOUR,
    });
    await scheduler.tick();
    await scheduler.tick();

    expect(api.createEvent).toHaveBeenCalledTimes(1);
    expect(api.createEvent).toHaveBeenCalledWith(GUILD_A.id, MOLTEN_CORE.channelId, API_KEY, {
      leaderId: LEADER_ID,
      templateId: 'wowclassic',
      startTime: EVENT_START,
      title: 'Molten Core',
      description: undefined,
    });
    expect(
      store.findPostedEvent(GUILD_A.id, storedEvent(store, 'Molten Core').id, '2026-11-04'),
    ).toMatchObject({
      postedBy: null,
    });
    expect(scheduler.upcomingEvents(GUILD_A.id).map((event) => event.title)).toContain(
      'Molten Core',
    );

    clock.now += 60;
    await scheduler.tick();
    expect(api.createEvent).toHaveBeenCalledTimes(1);
  });

  it('does not post a weekly event that already exists in the channel with its title', async () => {
    const { scheduler, api, store } = setup({
      events: [raidEvent({ title: 'molten core', startTime: EVENT_START + HOUR })],
      now: EVENT_START - 7 * 24 * HOUR,
    });
    await scheduler.tick();
    expect(api.createEvent).not.toHaveBeenCalled();
    expect(
      store.findPostedEvent(GUILD_A.id, storedEvent(store, 'Molten Core').id, '2026-11-04'),
    ).not.toBeNull();
  });

  it("fills the raid's date into a weekly event's title", async () => {
    const raidSetup = { events: [{ ...MOLTEN_CORE, title: 'Molten Core {day} {date}' }, ONYXIA] };
    const { scheduler, api } = setup({ events: [], raidSetup, now: EVENT_START - 7 * 24 * HOUR });
    await scheduler.tick();
    expect(api.createEvent.mock.calls[0][3].title).toBe('Molten Core Wed 11/4');
  });

  it("does not post a dated weekly event over one posted by hand with the event's name", async () => {
    const raidSetup = { events: [{ ...MOLTEN_CORE, title: 'MC {date}' }, ONYXIA] };
    const { scheduler, api } = setup({
      events: [raidEvent({ title: 'Molten Core', startTime: EVENT_START })],
      raidSetup,
      now: EVENT_START - 7 * 24 * HOUR,
    });
    await scheduler.tick();
    expect(api.createEvent).not.toHaveBeenCalled();
  });

  it('posts a weekly event even if another event in the channel starts at the same time', async () => {
    const { scheduler, api, store } = setup({
      events: [raidEvent({ id: '800000000000000009', title: 'Onyxia’s Lair' })],
      now: EVENT_START - 7 * 24 * HOUR,
    });
    await scheduler.tick();
    expect(api.createEvent).toHaveBeenCalledTimes(1);
    expect(
      store.findPostedEvent(GUILD_A.id, storedEvent(store, 'Molten Core').id, '2026-11-04').eventId,
    ).not.toBe('800000000000000009');
  });

  it('tries a failed post again next run', async () => {
    const { scheduler, api, clock } = setup({ events: [], now: EVENT_START - 7 * 24 * HOUR });
    api.createEvent.mockRejectedValueOnce(new RaidHelperError('HTTP 500', { status: 500 }));
    await scheduler.tick();
    clock.now += 600;
    await scheduler.tick();
    expect(api.createEvent).toHaveBeenCalledTimes(2);
  });

  it('tells the leader once a day that a weekly post keeps failing, and logs it', async () => {
    const { scheduler, api, clock, leader } = setup({
      events: [],
      now: EVENT_START - 7 * 24 * HOUR,
    });
    api.createEvent.mockRejectedValue(
      new RaidHelperError('Raid-Helper returned HTTP 400: unknown template', { status: 400 }),
    );
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(1);
    expect(leader.send.mock.calls[0][0].content).toContain(
      'the weekly **Molten Core** sign-up sheet for Wed Nov 4, 2026 could not be posted',
    );
    expect(leader.send.mock.calls[0][0].content).toContain('unknown template');

    clock.now += 600;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(1);

    clock.now += 24 * HOUR;
    await scheduler.tick();
    expect(leader.send).toHaveBeenCalledTimes(2);

    api.createEvent.mockReset();
    api.createEvent.mockImplementation(fakeApi().createEvent);
    clock.now += 600;
    await scheduler.tick();
    api.createEvent.mockRejectedValue(new RaidHelperError('HTTP 500', { status: 500 }));
    clock.now += 7 * 24 * HOUR;
    await scheduler.tick();
    // Working again resets it, so the next failure is reported at once.
    expect(leader.send).toHaveBeenCalledTimes(3);
  });

  it('does not post events that are not due yet', async () => {
    // Posted 5 days after the previous raid, 2 days before this one.
    const raidSetup = withWeekly({ weekday: 'wednesday', time: '19:30', postAfterHours: 120 });
    const { scheduler, api } = setup({ events: [], raidSetup, now: EVENT_START - 3 * 24 * HOUR });
    await scheduler.tick();
    expect(api.createEvent).not.toHaveBeenCalled();
  });
});

describe('RaidScheduler runs', () => {
  it('fetches the next 28 days of events with the server API key', async () => {
    const { scheduler, api, clock } = setup();
    await scheduler.tick();
    expect(api.listEvents).toHaveBeenCalledWith(GUILD_A.id, API_KEY, {
      startTime: clock.now,
      endTime: clock.now + LOOKAHEAD_SECONDS,
    });
  });

  it('skips servers without an API key or raid events', async () => {
    const noKey = setup({ apiKeys: new Map() });
    await noKey.scheduler.tick();
    expect(noKey.api.listEvents).not.toHaveBeenCalled();

    const noEvents = setup({ raidSetup: { events: [] } });
    await noEvents.scheduler.tick();
    expect(noEvents.api.listEvents).not.toHaveBeenCalled();
  });

  it('leaves events that have started out of the upcoming events', async () => {
    const { scheduler, clock } = setup();
    await scheduler.tick();
    expect(scheduler.upcomingEvents(GUILD_A.id)).toHaveLength(1);
    clock.now = EVENT_START;
    expect(scheduler.upcomingEvents(GUILD_A.id)).toEqual([]);
  });

  it('keeps the last events when Raid-Helper fails', async () => {
    const { scheduler, api } = setup();
    await scheduler.tick();
    api.listEvents.mockRejectedValue(new RaidHelperError('HTTP 401', { status: 401 }));
    await scheduler.tick();
    await scheduler.tick();
    expect(scheduler.upcomingEvents(GUILD_A.id)).toHaveLength(1);
  });

  it('does not start a run while one is in progress', async () => {
    const { scheduler, api } = setup();
    let release;
    api.listEvents.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const first = scheduler.tick();
    const second = scheduler.tick();
    expect(second).toBe(first);
    release([]);
    await first;
    expect(api.listEvents).toHaveBeenCalledTimes(1);
  });

  it('runs at once when the setup changes, or again right after a run in progress', async () => {
    const { scheduler, api } = setup();
    scheduler.refresh();
    // tick() returns the run refresh() started, so this waits for it to finish.
    await scheduler.tick();
    expect(api.listEvents).toHaveBeenCalledTimes(1);

    let release;
    api.listEvents.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const running = scheduler.tick();
    scheduler.refresh();
    scheduler.refresh();
    expect(api.listEvents).toHaveBeenCalledTimes(2);
    release([]);
    await running;
    // One more run, for the change made during the run.
    await vi.waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(3));
  });

  it('does not run again for a change once stopped', async () => {
    const { scheduler, api } = setup();
    await scheduler.stop();
    scheduler.refresh();
    await Promise.resolve();
    expect(api.listEvents).not.toHaveBeenCalled();
  });

  it('stops waiting for a run in progress after the time limit', async () => {
    const { scheduler, api } = setup();
    let release;
    api.listEvents.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    void scheduler.tick();
    await expect(scheduler.stop(10)).resolves.toBe(false);
    release([]);
    await expect(scheduler.stop(10)).resolves.toBe(true);
  });

  it('adds events posted outside a run to the upcoming events', async () => {
    const { scheduler } = setup({ events: [], raidSetup: withWeekly(undefined) });
    await scheduler.tick();
    const later = raidEvent({ id: '2', startTime: EVENT_START + HOUR });
    const sooner = raidEvent({ id: '1' });
    scheduler.addUpcomingEvent(GUILD_A.id, later);
    scheduler.addUpcomingEvent(GUILD_A.id, sooner);
    scheduler.addUpcomingEvent(GUILD_A.id, sooner);
    expect(scheduler.upcomingEvents(GUILD_A.id).map((event) => event.id)).toEqual(['1', '2']);
  });

  it('starts on a timer and stops after the run in progress', async () => {
    vi.useFakeTimers();
    try {
      const { scheduler, api } = setup();
      scheduler.start();
      await scheduler.stop();
      expect(api.listEvents).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(api.listEvents).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
