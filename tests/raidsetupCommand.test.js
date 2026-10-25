import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import raidsetup from '../src/commands/raids/raidsetup.js';
import { RaidHelperError } from '../src/raids/apiClient.js';
import { NOT_CONFIGURED_MESSAGE } from '../src/raids/commandContext.js';
import {
  NO_SUCH_EVENT_MESSAGE,
  canonicalTimeZone,
  parseReminderHours,
} from '../src/raids/handlers/setup.js';
import { GUILD_A, USER_ID } from './helpers/fakes.js';
import { lastMessage } from './helpers/lootInteraction.js';
import {
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  LEADER_ID,
  MOLTEN_CORE,
  OTHER_CHANNEL_ID,
  RAIDER_ROLE_ID,
  RAID_CHANNEL_ID,
  RAID_GUILD,
  RAID_SETTINGS,
  fakeApi,
  raidEvent,
  raidGuild,
  raidInteraction,
  raidMember,
  raidOptions,
  raidStore,
  raidsClient,
  seconds,
  storedEvent,
} from './helpers/raids.js';

// Saturday 2026-10-24, midday UTC.
const NOW = Date.parse('2026-10-24T12:00:00Z');
const officer = () => raidMember(USER_ID, 'Officer', [GUILD_A.officerRoleId]);
const leader = { id: LEADER_ID, bot: false };
const NEW_EVENT = {
  name: 'Barrow Deeps',
  channel: { id: GROUP_B_CHANNEL_ID },
  template: 'wowforever',
  leader,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function run(subcommand, values = {}, { store = raidStore(), ...rest } = {}) {
  const member = officer();
  const setup = raidInteraction({
    commandName: 'raidsetup',
    options: raidOptions(subcommand, values),
    guild: raidGuild([member]),
    member,
    store,
    ...rest,
  });
  await raidsetup.execute(setup.interaction, setup.context);
  return { ...setup, sent: lastMessage(setup.interaction) };
}

describe('/raidsetup definition and permissions', () => {
  it('registers as an Officer command with a panel and event and settings groups', () => {
    const json = raidsetup.data.toJSON();
    expect(json).toMatchObject({ name: 'raidsetup', default_member_permissions: '0' });
    expect(
      json.options.map((group) => [group.name, (group.options ?? []).map((option) => option.name)]),
    ).toEqual([
      ['panel', []],
      ['event', ['add', 'edit', 'remove', 'list']],
      ['settings', ['show', 'set']],
    ]);
  });

  it('may be used by Officers in servers with a Raid-Helper API key', () => {
    const member = (roleIds, client = raidsClient()) =>
      raidMember(USER_ID, 'Member', roleIds, { client });
    expect(raidsetup.canUse(member([GUILD_A.officerRoleId]), RAID_GUILD)).toBe(true);
    expect(raidsetup.canUse(member([RAIDER_ROLE_ID]), RAID_GUILD)).toBe(false);
    const noKey = raidsClient({ apiKeys: new Map() });
    expect(raidsetup.canUse(member([GUILD_A.officerRoleId], noKey), RAID_GUILD)).toBe(false);
  });

  it('explains when the feature is off', async () => {
    const { sent } = await run('event list', {}, { apiKeys: new Map() });
    expect(sent.content).toBe(NOT_CONFIGURED_MESSAGE);
  });
});

describe('/raidsetup event add', () => {
  it('adds an event and suggests checking its template', async () => {
    const { store, sent, interaction } = await run('event add', {
      ...NEW_EVENT,
      role: { id: GROUP_B_ROLE_ID },
      title: ' Barrow Deeps (10) ',
    });
    expect(storedEvent(store, 'Barrow Deeps')).toMatchObject({
      channelId: GROUP_B_CHANNEL_ID,
      templateId: 'wowforever',
      leaderId: LEADER_ID,
      raiderRoleId: GROUP_B_ROLE_ID,
      title: 'Barrow Deeps (10)',
    });
    expect(sent.content).toContain('Added **Barrow Deeps**');
    // So the new event shows up and posts without waiting for the next run.
    expect(interaction.client.raids.scheduler.refresh).toHaveBeenCalledTimes(1);
    expect(sent.content).toContain('Run `/raid create` once to check');
    expect(sent.allowedMentions).toEqual({ parse: [] });
  });

  it('reminds the Officer to add a new roster role to the /absence setting', async () => {
    const withRole = await run('event add', { ...NEW_EVENT, role: { id: GROUP_B_ROLE_ID } });
    expect(withRole.sent.content).toContain(
      `Members of <@&${GROUP_B_ROLE_ID}> see \`/absence\` only once the role is added`,
    );
    const shared = await run('event add', NEW_EVENT);
    expect(shared.sent.content).not.toContain('Integrations');
  });

  it('adds a weekly time, posted when the previous raid starts by default', async () => {
    const { store, sent } = await run('event add', {
      ...NEW_EVENT,
      weekday: 'friday',
      time: '20:00',
    });
    expect(storedEvent(store, 'Barrow Deeps').weekly).toEqual({
      weekday: 'friday',
      time: '20:00',
      postAfterHours: 0,
    });
    expect(sent.content).toContain(
      'Weekly: Friday at 20:00 (UTC), posted when the previous raid starts',
    );
  });

  it.each([
    [{ weekday: 'friday' }, 'needs both `weekday` and `time`'],
    [{ time: '20:00' }, 'needs both `weekday` and `time`'],
    [{ weekday: 'friday', time: '8pm' }, 'is not a time'],
    [{ title: 'Barrow {week}' }, 'The title has {week}, which the bot does not know'],
    [{ leader: { id: '799999999999999999', bot: true } }, 'must be a person, not a bot'],
    [{ name: 'molten core' }, 'There is already an event named "Molten Core"'],
    [
      { channel: { id: RAID_CHANNEL_ID }, role: { id: GROUP_B_ROLE_ID } },
      'are in the same channel but use different roster roles',
    ],
    [{ role: { id: GUILD_A.id } }, 'is the @everyone role'],
  ])('refuses %o', async (values, message) => {
    const { store, sent } = await run('event add', { ...NEW_EVENT, ...values });
    expect(sent.content).toContain(message);
    expect(store.raidEvents(GUILD_A.id).map((event) => event.name)).toEqual([
      'Molten Core',
      'Onyxia',
    ]);
  });

  it('refuses an event without a roster role when there is no shared one', async () => {
    const store = raidStore({ settings: { ...RAID_SETTINGS, raiderRoleId: null }, events: [] });
    const { sent } = await run('event add', NEW_EVENT, { store });
    expect(sent.content).toMatch(/Nothing was changed:\n- "Barrow Deeps" has no roster role/);
    expect(store.raidEvents(GUILD_A.id)).toEqual([]);
  });

  it('refuses a weekly time posted too late for the reminder hours', async () => {
    const { sent } = await run('event add', {
      ...NEW_EVENT,
      weekday: 'friday',
      time: '20:00',
      'post-after': 144,
    });
    expect(sent.content).toContain('so the 48, 24-hour reminders would never be sent');
  });
});

describe('/raidsetup event edit', () => {
  it('changes only the options given', async () => {
    const store = raidStore();
    const id = String(storedEvent(store, 'Molten Core').id);
    const { sent } = await run('event edit', { event: id, title: 'MC' }, { store });
    expect(storedEvent(store, 'Molten Core')).toMatchObject({ ...MOLTEN_CORE, title: 'MC' });
    expect(sent.content).toContain('Updated **Molten Core**');
  });

  it('finds the event by name too, and can rename it', async () => {
    const store = raidStore();
    await run('event edit', { event: 'onyxia', name: 'Onyxia 40' }, { store });
    expect(store.raidEvents(GUILD_A.id).map((event) => event.name)).toEqual([
      'Molten Core',
      'Onyxia 40',
    ]);
  });

  it('changes part of the weekly time and keeps the rest', async () => {
    const store = raidStore();
    await run('event edit', { event: 'Molten Core', weekday: 'thursday' }, { store });
    expect(storedEvent(store, 'Molten Core').weekly).toEqual({
      ...MOLTEN_CORE.weekly,
      weekday: 'thursday',
    });
    const { sent } = await run('event edit', { event: 'Molten Core', 'post-after': 3 }, { store });
    expect(storedEvent(store, 'Molten Core').weekly).toEqual({
      ...MOLTEN_CORE.weekly,
      weekday: 'thursday',
      postAfterHours: 3,
    });
    expect(sent.content).toContain('posted 3 hours after the previous raid starts');
  });

  it('offers when to post as choices, from when the previous raid starts to 6 days after', () => {
    const add = raidsetup.data
      .toJSON()
      .options.find((group) => group.name === 'event')
      .options.find((subcommand) => subcommand.name === 'add');
    const choices = add.options.find((option) => option.name === 'post-after').choices;
    expect(choices.at(0)).toEqual({ name: 'When the previous raid starts', value: 0 });
    expect(choices.at(3)).toEqual({ name: '3 hours after the previous raid starts', value: 3 });
    expect(choices.at(-1)).toEqual({ name: '6 days after the previous raid starts', value: 144 });
  });

  it('clears an optional field', async () => {
    const store = raidStore();
    await run('event edit', { event: 'Onyxia', clear: 'title' }, { store });
    expect(storedEvent(store, 'Onyxia').title).toBeUndefined();
    await run('event edit', { event: 'Molten Core', clear: 'weekly' }, { store });
    expect(storedEvent(store, 'Molten Core').weekly).toBeUndefined();
  });

  it('refuses clearing a field it is also given', async () => {
    const { sent } = await run('event edit', { event: 'Onyxia', title: 'X', clear: 'title' });
    expect(sent.content).toContain('`clear:title` cannot be used together with a new value');
    const weekly = await run('event edit', { event: 'Onyxia', time: '19:00', clear: 'weekly' });
    expect(weekly.sent.content).toContain('`clear:weekly` cannot be used together');
  });

  it('says when there is nothing to change or no such event', async () => {
    expect((await run('event edit', { event: 'Onyxia' })).sent.content).toContain(
      'Nothing to change',
    );
    expect((await run('event edit', { event: 'Naxxramas' })).sent.content).toBe(
      NO_SUCH_EVENT_MESSAGE,
    );
  });

  it('says that sheets already posted keep their weekly time', async () => {
    const store = raidStore();
    const moltenCore = storedEvent(store, 'Molten Core');
    store.recordPostedEvent(
      GUILD_A.id,
      { raidEventId: moltenCore.id, date: '2026-10-28', eventId: '1' },
      0,
    );
    const { sent } = await run('event edit', { event: 'Molten Core', time: '20:00' }, { store });
    expect(sent.content).toContain(
      'Sheets already posted (Wed Oct 28, 2026) are not moved; change or delete them in Raid-Helper.',
    );
  });

  it('keeps checking sheets already posted in the old channel after a move', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const sheet = raidEvent({ channelId: RAID_CHANNEL_ID });
    const { sent } = await run(
      'event edit',
      { event: 'Molten Core', channel: { id: OTHER_CHANNEL_ID } },
      { store, api: fakeApi([sheet]) },
    );
    expect(store.watchedChannels(GUILD_A.id, NOW / 1000)).toEqual([
      {
        channelId: RAID_CHANNEL_ID,
        // The shared role it used, so clearing the shared role later keeps the roster.
        raiderRoleId: RAIDER_ROLE_ID,
        eventName: 'Molten Core',
        watchUntil: sheet.startTime,
      },
    ]);
    expect(sent.content).toContain(
      `The sign-up sheet already posted in <#${RAID_CHANNEL_ID}> keeps its reminders`,
    );
  });

  it('does not watch the old channel while another event still uses it', async () => {
    const store = raidStore();
    await run(
      'event edit',
      { event: 'Molten Core', channel: { id: OTHER_CHANNEL_ID } },
      { store, api: fakeApi([raidEvent()]) },
    );
    expect(store.watchedChannels(GUILD_A.id, NOW / 1000)).toEqual([]);
  });

  it('keeps a change another Officer made while Raid-Helper was asked', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const api = fakeApi();
    api.listEvents.mockImplementation(async () => {
      store.updateRaidEvent(
        GUILD_A.id,
        { ...storedEvent(store, 'Molten Core'), title: 'Changed meanwhile' },
        '300000000000000009',
        0,
      );
      return [];
    });
    await run(
      'event edit',
      { event: 'Molten Core', channel: { id: OTHER_CHANNEL_ID } },
      { store, api },
    );
    expect(storedEvent(store, 'Molten Core')).toMatchObject({
      channelId: OTHER_CHANNEL_ID,
      title: 'Changed meanwhile',
    });
  });

  it('says when the event was removed while Raid-Helper was asked', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const api = fakeApi();
    api.listEvents.mockImplementation(async () => {
      store.deleteRaidEvent(GUILD_A.id, storedEvent(store, 'Molten Core').id);
      return [];
    });
    const { sent } = await run(
      'event edit',
      { event: 'Molten Core', channel: { id: OTHER_CHANNEL_ID } },
      { store, api },
    );
    expect(sent.content).toContain('"Molten Core" was removed meanwhile.');
    expect(store.raidEvents(GUILD_A.id)).toEqual([]);
  });

  it('refuses an edit that breaks a rule, leaving the event as it was', async () => {
    const store = raidStore();
    const { sent, interaction } = await run(
      'event edit',
      { event: 'Onyxia', role: { id: GROUP_B_ROLE_ID } },
      { store },
    );
    expect(sent.content).toContain('are in the same channel but use different roster roles');
    expect(storedEvent(store, 'Onyxia').raiderRoleId).toBeUndefined();
    expect(interaction.client.raids.scheduler.refresh).not.toHaveBeenCalled();
  });
});

describe('/raidsetup event remove', () => {
  it('removes the event and keeps checking its posted sheets until they start', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const later = raidEvent({ id: '2', startTime: seconds('2026-11-11T19:30:00Z') });
    const { sent } = await run(
      'event remove',
      { event: 'Molten Core' },
      { store, api: fakeApi([raidEvent(), later]) },
    );
    expect(store.raidEvents(GUILD_A.id)).toEqual([]);
    expect(store.watchedChannels(GUILD_A.id, NOW / 1000)).toMatchObject([
      { channelId: RAID_CHANNEL_ID, watchUntil: later.startTime },
    ]);
    expect(sent.content).toContain('Removed **Molten Core**');
    expect(sent.content).toContain('The 2 sign-up sheets already posted');
  });

  it('says when the event was removed while Raid-Helper was asked', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const api = fakeApi([raidEvent()]);
    api.listEvents.mockImplementation(async () => {
      store.deleteRaidEvent(GUILD_A.id, storedEvent(store, 'Molten Core').id);
      return [raidEvent()];
    });
    const { sent } = await run('event remove', { event: 'Molten Core' }, { store, api });
    expect(sent.content).toBe('**Molten Core** was already removed.');
    expect(store.watchedChannels(GUILD_A.id, 0)).toEqual([]);
  });

  it('does not watch the old channel of an event moved while Raid-Helper was asked', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const api = fakeApi();
    api.listEvents.mockImplementation(async () => {
      const moltenCore = storedEvent(store, 'Molten Core');
      store.updateRaidEvent(GUILD_A.id, { ...moltenCore, channelId: OTHER_CHANNEL_ID }, '1', 0);
      return [raidEvent()];
    });
    const { sent } = await run('event remove', { event: 'Molten Core' }, { store, api });
    expect(store.raidEvents(GUILD_A.id)).toEqual([]);
    expect(store.watchedChannels(GUILD_A.id, 0)).toEqual([]);
    expect(sent.content).not.toContain('sheet');
  });

  it('watches nothing when there are no posted sheets', async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const { sent } = await run('event remove', { event: 'Molten Core' }, { store });
    expect(store.watchedChannels(GUILD_A.id, 0)).toEqual([]);
    expect(sent.content).not.toContain('sheet');
  });

  it("uses the background loop's events when Raid-Helper cannot be reached", async () => {
    const store = raidStore({ events: [MOLTEN_CORE] });
    const api = fakeApi();
    api.listEvents.mockRejectedValue(new RaidHelperError('HTTP 503', { status: 503 }));
    const scheduler = {
      upcomingEvents: () => [raidEvent()],
      addUpcomingEvent: vi.fn(),
      refresh: vi.fn(),
    };
    const { sent } = await run('event remove', { event: 'Molten Core' }, { store, api, scheduler });
    expect(store.watchedChannels(GUILD_A.id, NOW / 1000)).toHaveLength(1);
    expect(sent.content).toContain('Raid-Helper could not be reached');
  });
});

describe('/raidsetup event list and settings show', () => {
  it('lists the events and the channels still checked', async () => {
    const store = raidStore();
    store.watchChannel(GUILD_A.id, {
      channelId: OTHER_CHANNEL_ID,
      eventName: 'Old raid',
      watchUntil: NOW / 1000 + 60,
    });
    const { sent } = await run('event list', {}, { store });
    const embed = sent.embeds[0].toJSON();
    expect(embed.fields.map((field) => field.name)).toEqual([
      'Molten Core',
      'Onyxia',
      'Still checked after removal',
    ]);
    expect(embed.fields[0].value).toContain(`Roster: <@&${RAIDER_ROLE_ID}> (shared)`);
    expect(embed.fields[1].value).toContain('Posted only with `/raid create`');
    expect(embed.fields[2].value).toContain('(was Old raid)');
  });

  it('sorts events by name without regard to case', async () => {
    const store = raidStore({ events: [{ ...MOLTEN_CORE, name: "Zul'Gurub" }, MOLTEN_CORE] });
    await run('event add', { ...NEW_EVENT, name: 'ahn Qiraj' }, { store });
    const { sent } = await run('event list', {}, { store });
    expect(sent.embeds[0].toJSON().fields.map((field) => field.name)).toEqual([
      'ahn Qiraj',
      'Molten Core',
      "Zul'Gurub",
    ]);
  });

  it('splits a long list over several messages to fit Discord', async () => {
    const events = Array.from({ length: 25 }, (_, i) => ({
      ...MOLTEN_CORE,
      name: `Molten Core group ${String(i).padStart(2, '0')}`,
      title: 'Molten Core (20)',
      description: 'Bring fire resistance gear and pots. Pull at 19:15 sharp.',
    }));
    const { interaction } = await run('event list', {}, { store: raidStore({ events }) });
    const embeds = [...interaction.reply.mock.calls, ...interaction.followUp.mock.calls].map(
      ([options]) => options.embeds[0].toJSON(),
    );
    expect(embeds.length).toBeGreaterThan(1);
    expect(embeds[0].title).toBe(`Raid events (1/${embeds.length})`);
    expect(embeds.flatMap((embed) => embed.fields)).toHaveLength(25);
    for (const embed of embeds) {
      const size =
        embed.title.length +
        embed.fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
      expect(size).toBeLessThanOrEqual(6000);
    }
  });

  it('shows the defaults before anything is set', async () => {
    const { sent } = await run('settings show', {}, { store: raidStore({ settings: null }) });
    const values = Object.fromEntries(
      sent.embeds[0].toJSON().fields.map((field) => [field.name, field.value]),
    );
    expect(values).toEqual({
      'Absences channel': 'Not set: `/absence add` is off until it is.',
      'Shared roster role': 'Not set: every event needs its own roster role.',
      'Time zone': 'UTC (from the raid reset; not set)',
      'Reminder hours': '48, 24 hours before each event, and when sign-ups close',
      'Member DMs': 'Off',
    });
  });
});

describe('/raidsetup settings set', () => {
  it('saves only the settings given', async () => {
    const store = raidStore();
    const { sent } = await run(
      'settings set',
      { 'time-zone': 'america/los_angeles', 'reminder-hours': '24, 72', 'member-dms': true },
      { store },
    );
    expect(store.getSettings(GUILD_A.id)).toEqual({
      ...RAID_SETTINGS,
      timeZone: 'America/Los_Angeles',
      reminderHours: [72, 24],
      memberDms: true,
    });
    expect(sent.content).toContain('Saved the raid settings.');
    expect(sent.content).toContain('Sheets already posted keep their times');
    expect(sent.content).toContain('A new hour that has already passed');
  });

  it('saves the first settings of a server over the defaults', async () => {
    const store = raidStore({ settings: null, events: [] });
    await run('settings set', { 'absence-channel': { id: OTHER_CHANNEL_ID } }, { store });
    expect(store.getSettings(GUILD_A.id)).toEqual({
      absenceChannelId: OTHER_CHANNEL_ID,
      raiderRoleId: null,
      timeZone: null,
      reminderHours: [48, 24],
      memberDms: false,
    });
  });

  it('reminds the Officer to add a new shared roster role to the /absence setting', async () => {
    const { sent } = await run('settings set', { 'roster-role': { id: GROUP_B_ROLE_ID } });
    expect(sent.content).toContain(`Members of <@&${GROUP_B_ROLE_ID}> see \`/absence\``);
  });

  it('clears a setting', async () => {
    const store = raidStore();
    await run('settings set', { clear: 'absence-channel' }, { store });
    expect(store.getSettings(GUILD_A.id).absenceChannelId).toBeNull();
  });

  it.each([
    [{ 'time-zone': 'Mars/Base' }, 'is not a time zone'],
    [{ 'reminder-hours': '200' }, 'is not a list of reminder hours'],
    [{ 'reminder-hours': '168' }, 'would never be sent'],
    [{ clear: 'roster-role' }, 'has no roster role, and there is no shared roster role'],
    [{ 'roster-role': { id: GUILD_A.id } }, 'The shared roster role is the @everyone role'],
    [{}, 'Nothing to change'],
    [{ clear: 'time-zone', 'time-zone': 'UTC' }, '`clear:time-zone` cannot be used together'],
  ])('refuses %o', async (values, message) => {
    const store = raidStore();
    const { sent } = await run('settings set', values, { store });
    expect(sent.content).toContain(message);
    expect(store.getSettings(GUILD_A.id)).toEqual(RAID_SETTINGS);
  });
});

describe('reading settings', () => {
  it('parses reminder hours', () => {
    expect(parseReminderHours('24 72, 1')).toEqual({ hours: [72, 24, 1] });
    expect(parseReminderHours('none')).toEqual({ hours: [] });
    for (const bad of ['', '0', '1.5', '24, 24', '1 2 3 4 5 6', 'soon']) {
      expect(parseReminderHours(bad).error, bad).toBeDefined();
    }
  });

  it('spells time zones the canonical way', () => {
    expect(canonicalTimeZone('europe/london')).toBe('Europe/London');
    expect(canonicalTimeZone('utc')).toBe('UTC');
    expect(canonicalTimeZone('Nowhere/Land')).toBeNull();
  });
});

describe('/raidsetup autocomplete', () => {
  async function suggest(subcommand, focused, { scheduler } = {}) {
    const member = officer();
    const setup = raidInteraction({
      commandName: 'raidsetup',
      options: raidOptions(subcommand, {}, { focused }),
      guild: raidGuild([member]),
      member,
      ...(scheduler && { scheduler }),
    });
    await raidsetup.autocomplete(setup.interaction, setup.context);
    return setup.interaction.respond.mock.calls[0][0];
  }

  it('suggests events by name, with their IDs as values', async () => {
    const choices = await suggest('event edit', { name: 'event', value: 'ony' });
    expect(choices).toEqual([{ name: 'Onyxia', value: expect.stringMatching(/^\d+$/) }]);
  });

  it("suggests the templates of the server's events, after what was typed", async () => {
    const scheduler = {
      upcomingEvents: () => [raidEvent({ templateId: 'wowforever' })],
      addUpcomingEvent: vi.fn(),
    };
    expect(await suggest('event add', { name: 'template', value: '' }, { scheduler })).toEqual([
      { name: 'wowclassic', value: 'wowclassic' },
      { name: 'wowforever', value: 'wowforever' },
    ]);
    expect(await suggest('event add', { name: 'template', value: 'wowf' }, { scheduler })).toEqual([
      { name: 'wowf', value: 'wowf' },
      { name: 'wowforever', value: 'wowforever' },
    ]);
  });

  it('suggests time zones', async () => {
    const choices = await suggest('settings set', { name: 'time-zone', value: 'los ang' });
    expect(choices).toEqual([{ name: 'America/Los_Angeles', value: 'America/Los_Angeles' }]);
  });
});
