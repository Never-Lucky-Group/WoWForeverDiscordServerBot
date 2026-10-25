import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_HOURS, loadSetup, setupProblems } from '../src/raids/setup.js';
import { GUILD_A } from './helpers/fakes.js';
import {
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  MOLTEN_CORE,
  ONYXIA,
  RAIDER_ROLE_ID,
  RAID_GUILD,
  RAID_SETTINGS,
  memoryRaidStore,
  raidStore,
} from './helpers/raids.js';

describe('loadSetup', () => {
  it('uses the defaults when nothing is saved, with the raid reset time zone', () => {
    const store = memoryRaidStore();
    expect(loadSetup(store, RAID_GUILD, 0)).toEqual({
      absenceChannelId: null,
      raiderRoleId: null,
      timeZone: 'UTC',
      timeZoneSetting: null,
      reminderHours: DEFAULT_REMINDER_HOURS,
      memberDms: false,
      events: [],
      watched: [],
    });
    const raidReset = { weekday: 'tuesday', time: '15:00', timeZone: 'America/Chicago' };
    expect(loadSetup(store, { ...RAID_GUILD, raidReset }, 0).timeZone).toBe('America/Chicago');
  });

  it('reads the saved settings, events and watched channels', () => {
    const store = raidStore({ settings: { ...RAID_SETTINGS, timeZone: 'Europe/London' } });
    store.watchChannel(GUILD_A.id, { channelId: '1', eventName: 'Old', watchUntil: 100 });
    const setup = loadSetup(store, RAID_GUILD, 50);
    expect(setup).toMatchObject({ timeZone: 'Europe/London', timeZoneSetting: 'Europe/London' });
    expect(setup.events.map((event) => event.name)).toEqual(['Molten Core', 'Onyxia']);
    expect(setup.watched.map((watched) => watched.channelId)).toEqual(['1']);
    expect(loadSetup(store, RAID_GUILD, 100).watched).toEqual([]);
  });
});

describe('setupProblems', () => {
  const problems = (events, settings = RAID_SETTINGS, guildConfig = RAID_GUILD) =>
    setupProblems({ settings, events }, guildConfig);
  const groupB = {
    ...MOLTEN_CORE,
    name: 'Molten Core B',
    channelId: GROUP_B_CHANNEL_ID,
    raiderRoleId: GROUP_B_ROLE_ID,
  };

  it('accepts a valid setup', () => {
    expect(problems([MOLTEN_CORE, ONYXIA, groupB])).toEqual([]);
  });

  it('rejects duplicate names, ignoring case', () => {
    expect(problems([MOLTEN_CORE, { ...ONYXIA, name: 'molten core' }])).toEqual([
      'There is already an event named "Molten Core".',
    ]);
  });

  it('rejects more than 25 events', () => {
    const events = Array.from({ length: 26 }, (_, i) => ({ ...ONYXIA, name: `E${i}` }));
    expect(problems(events)).toContain('A server can have at most 25 raid events.');
  });

  it('rejects an event with no roster role when there is no shared one', () => {
    expect(problems([MOLTEN_CORE, groupB], { ...RAID_SETTINGS, raiderRoleId: null })).toEqual([
      expect.stringMatching(/^"Molten Core" has no roster role, and there is no shared/),
    ]);
  });

  it('rejects events in one channel with different roster roles', () => {
    const sameChannel = { ...groupB, channelId: MOLTEN_CORE.channelId };
    expect(problems([MOLTEN_CORE, sameChannel])).toEqual([
      expect.stringMatching(/^"Molten Core B" and "Molten Core" are in the same channel/),
    ]);
    // The same role, given or shared, is fine.
    expect(problems([MOLTEN_CORE, { ...sameChannel, raiderRoleId: RAIDER_ROLE_ID }])).toEqual([]);
  });

  it('rejects @everyone and the join role as roster roles', () => {
    const joinRoleId = '700000000000000009';
    const guildConfig = { ...RAID_GUILD, joinRoleId };
    expect(problems([{ ...groupB, raiderRoleId: GUILD_A.id }], RAID_SETTINGS, guildConfig)).toEqual(
      ['The roster role of "Molten Core B" is the @everyone role.'],
    );
    expect(
      problems([MOLTEN_CORE], { ...RAID_SETTINGS, raiderRoleId: joinRoleId }, guildConfig),
    ).toEqual([
      'The shared roster role is the role every new member gets, so it cannot be a roster.',
    ]);
  });

  it('rejects reminder hours at or before a weekly event is posted', () => {
    const weekly = { ...MOLTEN_CORE.weekly, postDaysAhead: 2 };
    expect(problems([{ ...MOLTEN_CORE, weekly }])).toEqual([
      '"Molten Core" is posted 2 days (48 hours) ahead, so the 48-hour reminder would never be ' +
        'sent for it. Lower the reminder hours or post it earlier.',
    ]);
    expect(
      problems([{ ...MOLTEN_CORE, weekly }], { ...RAID_SETTINGS, reminderHours: [47] }),
    ).toEqual([]);
    // Events posted only with /raid create are first seen whenever they are posted.
    expect(problems([ONYXIA], { ...RAID_SETTINGS, reminderHours: [168] })).toEqual([]);
  });
});
