import { describe, expect, it } from 'vitest';
import {
  duePoint,
  duePosts,
  eventUrl,
  isConfiguredEvent,
  postTime,
  reminderPoints,
  rosterRoleId,
  rosterRoleIds,
  weeklyOccurrences,
} from '../src/raids/schedule.js';
import { GUILD_A, GUILD_B } from './helpers/fakes.js';
import {
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  MOLTEN_CORE,
  ONYXIA,
  OTHER_CHANNEL_ID,
  RAID_CHANNEL_ID,
  RAIDER_ROLE_ID,
  raidEvent,
  seconds,
} from './helpers/raids.js';

const HOUR = 60 * 60;
// A raid setup as loadSetup() returns it, with the parts these helpers read.
const SETUP = { raiderRoleId: RAIDER_ROLE_ID, events: [MOLTEN_CORE, ONYXIA], watched: [] };

describe('weeklyOccurrences', () => {
  const weekly = { weekday: 'wednesday', time: '19:30', postAfterHours: 0 };

  it('lists the weekly start times in the window', () => {
    expect(
      weeklyOccurrences(
        weekly,
        'UTC',
        seconds('2026-10-24T00:00:00Z'),
        seconds('2026-11-11T19:30:00Z'),
      ),
    ).toEqual([
      seconds('2026-10-28T19:30:00Z'),
      seconds('2026-11-04T19:30:00Z'),
      seconds('2026-11-11T19:30:00Z'),
    ]);
  });

  it('keeps the local time across a daylight saving change', () => {
    // London: summer time (UTC+1) ends on 2026-10-25.
    expect(
      weeklyOccurrences(
        weekly,
        'Europe/London',
        seconds('2026-10-19T00:00:00Z'),
        seconds('2026-10-31T00:00:00Z'),
      ),
    ).toEqual([seconds('2026-10-21T18:30:00Z'), seconds('2026-10-28T19:30:00Z')]);
  });

  it('uses the local weekday far from UTC', () => {
    // Wednesday 21:00 in Los Angeles is Thursday 05:00 UTC.
    const lateWeekly = { ...weekly, time: '21:00' };
    expect(
      weeklyOccurrences(
        lateWeekly,
        'America/Los_Angeles',
        seconds('2026-11-02T00:00:00Z'),
        seconds('2026-11-09T00:00:00Z'),
      ),
    ).toEqual([seconds('2026-11-05T05:00:00Z')]);
  });
});

describe('duePosts', () => {
  it('posts a sheet when the previous raid starts, by default', () => {
    // Wednesday 2026-10-28 19:30; the next is 2026-11-04 19:30, exactly 7 days later.
    const now = seconds('2026-10-28T19:30:00Z');
    expect(duePosts(MOLTEN_CORE, 'UTC', now)).toEqual([
      { date: '2026-11-04', startTime: seconds('2026-11-04T19:30:00Z') },
    ]);
  });

  it('leaves out an occurrence whose previous raid has not started yet', () => {
    // The 2026-11-04 occurrence is 7 days and 1 minute away.
    expect(duePosts(MOLTEN_CORE, 'UTC', seconds('2026-10-28T19:29:00Z'))).toEqual([
      { date: '2026-10-28', startTime: seconds('2026-10-28T19:30:00Z') },
    ]);
  });

  it('posts a sheet the chosen hours after the previous raid starts', () => {
    const late = { ...MOLTEN_CORE, weekly: { ...MOLTEN_CORE.weekly, postAfterHours: 3 } };
    // The previous raid started at 19:30 on Wednesday 2026-10-28.
    expect(duePosts(late, 'UTC', seconds('2026-10-28T22:29:00Z'))).toEqual([]);
    expect(duePosts(late, 'UTC', seconds('2026-10-28T22:30:00Z'))).toEqual([
      { date: '2026-11-04', startTime: seconds('2026-11-04T19:30:00Z') },
    ]);
  });

  it('counts the hours from the previous raid on the local clock across daylight saving', () => {
    // Los Angeles leaves daylight saving on Sunday 2026-11-01. The previous raid starts at
    // 19:30 PDT on 2026-10-28 (02:30 UTC the next day), so the sheet is due 3 hours later, at
    // 05:30 UTC: 166 hours before the 2026-11-04 raid at 19:30 PST, not 165.
    const late = { ...MOLTEN_CORE, weekly: { ...MOLTEN_CORE.weekly, postAfterHours: 3 } };
    const timeZone = 'America/Los_Angeles';
    expect(postTime(late.weekly, '2026-11-04', timeZone)).toBe(seconds('2026-10-29T05:30:00Z'));
    expect(duePosts(late, timeZone, seconds('2026-10-29T05:29:00Z'))).toEqual([]);
    expect(duePosts(late, timeZone, seconds('2026-10-29T05:30:00Z'))).toEqual([
      { date: '2026-11-04', startTime: seconds('2026-11-05T03:30:00Z') },
    ]);
  });

  it('returns nothing for an event without a weekly time', () => {
    expect(duePosts({ ...MOLTEN_CORE, weekly: undefined }, 'UTC', 0)).toEqual([]);
  });
});

describe('reminderPoints', () => {
  it('lists the hour points and the close time, earliest first', () => {
    const event = raidEvent({ closeTime: seconds('2026-11-04T07:30:00Z') });
    expect(reminderPoints(event, [24, 48])).toEqual([
      { key: '48h', at: event.startTime - 48 * HOUR, hours: 48 },
      { key: '24h', at: event.startTime - 24 * HOUR, hours: 24 },
      { key: 'close', at: event.closeTime },
    ]);
  });

  it('ignores a close time at or after the start', () => {
    const event = raidEvent();
    expect(reminderPoints({ ...event, closeTime: event.startTime }, [24])).toEqual([
      { key: '24h', at: event.startTime - 24 * HOUR, hours: 24 },
    ]);
  });
});

describe('duePoint', () => {
  const event = raidEvent();
  const points = reminderPoints(event, [48, 24]);
  const at48 = event.startTime - 48 * HOUR;
  const at24 = event.startTime - 24 * HOUR;
  const due = (now, { firstSeenAt = 0, sent = [] } = {}) =>
    duePoint(points, { now, firstSeenAt, startTime: event.startTime, sent: new Set(sent) })?.key ??
    null;

  it('returns nothing before the first point', () => {
    expect(due(at48 - 1)).toBeNull();
  });

  it('returns a point once it has passed', () => {
    expect(due(at48)).toBe('48h');
    expect(due(at24 + 60, { sent: ['48h'] })).toBe('24h');
  });

  it('returns nothing for a point already sent', () => {
    expect(due(at48 + 60, { sent: ['48h'] })).toBeNull();
  });

  it('returns only the latest point after downtime', () => {
    expect(due(at24 + 60)).toBe('24h');
  });

  it('skips points that passed before the event was first seen', () => {
    expect(due(at48 + 60, { firstSeenAt: at48 + 30 })).toBeNull();
    expect(due(at24, { firstSeenAt: at48 + 30 })).toBe('24h');
  });

  it('returns nothing once the event has started', () => {
    expect(due(event.startTime)).toBeNull();
  });
});

describe('isConfiguredEvent', () => {
  it("accepts events in the server's raid channels", () => {
    expect(isConfiguredEvent(raidEvent(), SETUP, GUILD_A.id)).toBe(true);
    expect(isConfiguredEvent(raidEvent({ serverId: null }), SETUP, GUILD_A.id)).toBe(true);
  });

  it('accepts events in a channel still watched after its event was removed', () => {
    const watched = { ...SETUP, watched: [{ channelId: OTHER_CHANNEL_ID, eventName: 'Old' }] };
    expect(isConfiguredEvent(raidEvent({ channelId: OTHER_CHANNEL_ID }), watched, GUILD_A.id)).toBe(
      true,
    );
  });

  it('rejects events in other channels or servers', () => {
    const otherChannel = raidEvent({ channelId: OTHER_CHANNEL_ID });
    expect(isConfiguredEvent(otherChannel, SETUP, GUILD_A.id)).toBe(false);
    expect(isConfiguredEvent(raidEvent({ serverId: GUILD_B.id }), SETUP, GUILD_A.id)).toBe(false);
  });
});

describe('roster roles', () => {
  const groupB = {
    ...MOLTEN_CORE,
    name: 'Molten Core B',
    channelId: GROUP_B_CHANNEL_ID,
    raiderRoleId: GROUP_B_ROLE_ID,
  };
  const setup = { ...SETUP, events: [...SETUP.events, groupB] };

  it("uses the channel's event role, else the shared role", () => {
    expect(rosterRoleId(setup, GROUP_B_CHANNEL_ID)).toBe(GROUP_B_ROLE_ID);
    expect(rosterRoleId(setup, RAID_CHANNEL_ID)).toBe(RAIDER_ROLE_ID);
  });

  it("uses a watched channel's role only while no event uses the channel", () => {
    const watched = { channelId: GROUP_B_CHANNEL_ID, raiderRoleId: '700000000000000009' };
    expect(rosterRoleId({ ...SETUP, watched: [watched] }, GROUP_B_CHANNEL_ID)).toBe(
      '700000000000000009',
    );
    expect(rosterRoleId({ ...setup, watched: [watched] }, GROUP_B_CHANNEL_ID)).toBe(
      GROUP_B_ROLE_ID,
    );
  });

  it('lists every roster role once', () => {
    expect(rosterRoleIds(setup)).toEqual(new Set([RAIDER_ROLE_ID, GROUP_B_ROLE_ID]));
    expect(rosterRoleIds({ ...setup, raiderRoleId: null, events: [groupB] })).toEqual(
      new Set([GROUP_B_ROLE_ID]),
    );
  });
});

describe('eventUrl', () => {
  it("links to the event's message", () => {
    expect(eventUrl(GUILD_A.id, raidEvent())).toBe(
      `https://discord.com/channels/${GUILD_A.id}/720000000000000001/800000000000000001`,
    );
  });
});
