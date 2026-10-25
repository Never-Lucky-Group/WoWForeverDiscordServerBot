import { describe, expect, it } from 'vitest';
import { RETENTION_SECONDS } from '../src/raids/store.js';
import { GUILD_A, GUILD_B, USER_ID } from './helpers/fakes.js';
import { memoryRaidStore, raidEvent, seconds } from './helpers/raids.js';

const OTHER_USER = '300000000000000002';
const NOW = seconds('2026-10-24T12:00:00Z');

function absence(overrides = {}) {
  return {
    userId: USER_ID,
    startsOn: '2026-11-04',
    endsOn: '2026-11-04',
    reason: 'Work',
    createdBy: USER_ID,
    source: 'command',
    ...overrides,
  };
}

describe('RaidStore absences', () => {
  it('adds and returns an absence with its number', () => {
    const store = memoryRaidStore();
    const added = store.addAbsence(GUILD_A.id, absence(), NOW);
    expect(added).toEqual({
      id: 1,
      userId: USER_ID,
      startsOn: '2026-11-04',
      endsOn: '2026-11-04',
      reason: 'Work',
      createdBy: USER_ID,
      createdAt: NOW,
      source: 'command',
    });
    expect(store.getAbsence(GUILD_A.id, 1)).toEqual(added);
    expect(store.getAbsence(GUILD_B.id, 1)).toBeNull();
  });

  it('lists absences that have not ended, soonest first, optionally for one member', () => {
    const store = memoryRaidStore();
    store.addAbsence(GUILD_A.id, absence({ startsOn: '2026-11-10', endsOn: '2026-11-12' }), NOW);
    store.addAbsence(GUILD_A.id, absence({ startsOn: '2026-10-01', endsOn: '2026-10-02' }), NOW);
    store.addAbsence(GUILD_A.id, absence({ userId: OTHER_USER }), NOW);
    store.addAbsence(GUILD_B.id, absence(), NOW);

    expect(store.upcomingAbsences(GUILD_A.id, '2026-10-24').map((a) => a.id)).toEqual([3, 1]);
    expect(store.upcomingAbsences(GUILD_A.id, '2026-10-24', USER_ID).map((a) => a.id)).toEqual([1]);
  });

  it('finds members absent on a date, both ends included', () => {
    const store = memoryRaidStore();
    store.addAbsence(GUILD_A.id, absence({ startsOn: '2026-11-04', endsOn: '2026-11-06' }), NOW);
    expect(store.absentUserIds(GUILD_A.id, '2026-11-03')).toEqual(new Set());
    expect(store.absentUserIds(GUILD_A.id, '2026-11-04')).toEqual(new Set([USER_ID]));
    expect(store.absentUserIds(GUILD_A.id, '2026-11-06')).toEqual(new Set([USER_ID]));
    expect(store.absentUserIds(GUILD_B.id, '2026-11-05')).toEqual(new Set());
  });

  it('deletes an absence and never reuses its number', () => {
    const store = memoryRaidStore();
    store.addAbsence(GUILD_A.id, absence(), NOW);
    expect(store.deleteAbsence(GUILD_B.id, 1)).toBe(false);
    expect(store.deleteAbsence(GUILD_A.id, 1)).toBe(true);
    expect(store.deleteAbsence(GUILD_A.id, 1)).toBe(false);
    expect(store.addAbsence(GUILD_A.id, absence(), NOW).id).toBe(2);
  });
});

describe('RaidStore event tracking', () => {
  it('records posted events by raid event and date', () => {
    const store = memoryRaidStore();
    expect(store.findPostedEvent(GUILD_A.id, 7, '2026-11-04')).toBeNull();
    store.recordPostedEvent(
      GUILD_A.id,
      { raidEventId: 7, date: '2026-11-04', eventId: '1', postedBy: USER_ID },
      NOW,
    );
    expect(store.postedDates(GUILD_A.id, 7, '2026-11-04')).toEqual(['2026-11-04']);
    expect(store.postedDates(GUILD_A.id, 7, '2026-11-05')).toEqual([]);
    expect(store.findPostedEvent(GUILD_A.id, 7, '2026-11-04')).toEqual({
      eventId: '1',
      postedBy: USER_ID,
      postedAt: NOW,
    });
  });

  it('keeps who posted an event when it is found again, and replaces a different event', () => {
    const store = memoryRaidStore();
    const record = (eventId, postedBy, now) =>
      store.recordPostedEvent(
        GUILD_A.id,
        { raidEventId: 7, date: '2026-11-04', eventId, postedBy },
        now,
      );
    record('1', USER_ID, NOW);
    record('1', null, NOW + 60);
    expect(store.findPostedEvent(GUILD_A.id, 7, '2026-11-04')).toEqual({
      eventId: '1',
      postedBy: USER_ID,
      postedAt: NOW,
    });

    record('2', null, NOW + 120);
    expect(store.findPostedEvent(GUILD_A.id, 7, '2026-11-04')).toEqual({
      eventId: '2',
      postedBy: null,
      postedAt: NOW + 120,
    });
  });

  it('keeps the first time an event was seen', () => {
    const store = memoryRaidStore();
    const event = raidEvent();
    expect(store.markSeen(GUILD_A.id, [event], NOW)).toEqual(new Map([[event.id, NOW]]));
    expect(store.markSeen(GUILD_A.id, [event], NOW + 600)).toEqual(new Map([[event.id, NOW]]));
  });

  it('tracks reminder points per start time', () => {
    const store = memoryRaidStore();
    store.markReminderSent(GUILD_A.id, '1', 1000, '24h', NOW);
    store.markReminderSent(GUILD_A.id, '1', 1000, '24h', NOW);
    expect(store.sentReminderPoints(GUILD_A.id, '1', 1000)).toEqual(new Set(['24h']));
    expect(store.sentReminderPoints(GUILD_A.id, '1', 2000)).toEqual(new Set());
  });

  it('tracks member DMs and answers', () => {
    const store = memoryRaidStore();
    store.recordMemberDm(GUILD_A.id, { eventId: '1', userId: USER_ID, startTime: 1000 }, NOW);
    store.recordMemberAnswer(GUILD_A.id, { eventId: '1', userId: USER_ID, answer: 'no' }, NOW);
    expect(store.dmedUserIds(GUILD_A.id, '1')).toEqual(new Set([USER_ID]));
    expect(store.db.prepare('SELECT answer FROM member_dms').get().answer).toBe('no');
  });

  it('cleans up rows about events that started long ago, keeping absences', () => {
    const store = memoryRaidStore();
    const old = NOW - RETENTION_SECONDS - 1;
    store.markSeen(GUILD_A.id, [raidEvent({ id: 'old', startTime: old })], old);
    store.markSeen(GUILD_A.id, [raidEvent({ id: 'new', startTime: NOW })], NOW);
    store.markReminderSent(GUILD_A.id, 'old', old, '24h', old);
    store.recordMemberDm(GUILD_A.id, { eventId: 'old', userId: USER_ID, startTime: old }, old);
    store.recordPostedEvent(
      GUILD_A.id,
      { raidEventId: 7, date: '2026-01-01', eventId: 'old' },
      old,
    );
    store.addAbsence(GUILD_A.id, absence({ startsOn: '2026-01-01', endsOn: '2026-01-01' }), old);
    store.watchChannel(GUILD_A.id, { channelId: '1', eventName: 'Old', watchUntil: NOW });
    store.watchChannel(GUILD_A.id, { channelId: '2', eventName: 'New', watchUntil: NOW + 1 });

    store.cleanup(NOW);

    const count = (table) => store.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    expect(count('events_seen')).toBe(1);
    expect(count('reminders_sent')).toBe(0);
    expect(count('member_dms')).toBe(0);
    expect(count('posted_events')).toBe(0);
    expect(count('absences')).toBe(1);
    expect(store.watchedChannels(GUILD_A.id, 0).map((watched) => watched.channelId)).toEqual(['2']);
  });
});

describe('RaidStore raid setup', () => {
  const event = {
    name: 'Molten Core',
    channelId: '720000000000000001',
    templateId: 'wowforever',
    leaderId: '730000000000000001',
  };

  it('has no settings until they are saved', () => {
    const store = memoryRaidStore();
    expect(store.getSettings(GUILD_A.id)).toBeNull();
    const settings = {
      absenceChannelId: '710000000000000001',
      raiderRoleId: null,
      timeZone: 'America/Chicago',
      reminderHours: [72, 24],
      memberDms: true,
    };
    store.saveSettings(GUILD_A.id, settings, USER_ID, NOW);
    expect(store.getSettings(GUILD_A.id)).toEqual(settings);
    store.saveSettings(GUILD_A.id, { ...settings, memberDms: false }, USER_ID, NOW);
    expect(store.getSettings(GUILD_A.id).memberDms).toBe(false);
  });

  it('adds, updates and deletes raid events, leaving out unset fields', () => {
    const store = memoryRaidStore();
    const id = store.addRaidEvent(GUILD_A.id, event, USER_ID, NOW);
    expect(store.raidEvents(GUILD_A.id)).toEqual([{ id, ...event }]);

    const weekly = { weekday: 'wednesday', time: '19:30', postDaysAhead: 7 };
    store.updateRaidEvent(
      GUILD_A.id,
      { id, ...event, title: 'MC', raiderRoleId: '700000000000000001', weekly },
      USER_ID,
      NOW,
    );
    expect(store.raidEvents(GUILD_A.id)).toEqual([
      { id, ...event, title: 'MC', raiderRoleId: '700000000000000001', weekly },
    ]);
    expect(store.raidEvents(GUILD_B.id)).toEqual([]);

    store.deleteRaidEvent(GUILD_A.id, id);
    expect(store.raidEvents(GUILD_A.id)).toEqual([]);
  });

  it('keeps the later time for a channel watched twice', () => {
    const store = memoryRaidStore();
    store.watchChannel(GUILD_A.id, { channelId: '1', eventName: 'A', watchUntil: NOW + 100 });
    store.watchChannel(GUILD_A.id, { channelId: '1', eventName: 'B', watchUntil: NOW + 50 });
    expect(store.watchedChannels(GUILD_A.id, NOW)).toEqual([
      { channelId: '1', eventName: 'A', watchUntil: NOW + 100, raiderRoleId: undefined },
    ]);
    expect(store.watchedChannels(GUILD_A.id, NOW + 100)).toEqual([]);
  });
});
