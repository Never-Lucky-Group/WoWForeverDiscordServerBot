import { describe, expect, it } from 'vitest';
import { localDate, parseLocalDate, raidWeeksStart } from '../src/loot/raidWeeks.js';

const at = (iso) => Date.parse(iso);
const seconds = (iso) => Date.parse(iso) / 1000;

describe('raidWeeksStart', () => {
  const reset = { weekday: 'tuesday', time: '15:00', timeZone: 'UTC' };

  it('returns the most recent reset for one week', () => {
    // Thursday 2026-11-12.
    expect(raidWeeksStart(1, reset, at('2026-11-12T10:00:00Z'))).toBe(
      seconds('2026-11-10T15:00:00Z'),
    );
  });

  it('counts back whole raid weeks', () => {
    expect(raidWeeksStart(3, reset, at('2026-11-12T10:00:00Z'))).toBe(
      seconds('2026-10-27T15:00:00Z'),
    );
  });

  it('uses the previous week on reset day before the reset time', () => {
    expect(raidWeeksStart(1, reset, at('2026-11-10T14:59:00Z'))).toBe(
      seconds('2026-11-03T15:00:00Z'),
    );
  });

  it('uses the same day from the reset time on', () => {
    expect(raidWeeksStart(1, reset, at('2026-11-10T15:00:00Z'))).toBe(
      seconds('2026-11-10T15:00:00Z'),
    );
  });

  it('keeps the local reset time across a daylight saving change', () => {
    // EU reset Wednesday 04:00 London time. British Summer Time ended on 2026-10-25.
    const euReset = { weekday: 'wednesday', time: '04:00', timeZone: 'Europe/London' };
    const now = at('2026-11-05T12:00:00Z');
    expect(raidWeeksStart(1, euReset, now)).toBe(seconds('2026-11-04T04:00:00Z'));
    // Two weeks back is 2026-10-21, still summer time (UTC+1).
    expect(raidWeeksStart(3, euReset, now)).toBe(seconds('2026-10-21T03:00:00Z'));
  });

  it('uses the local weekday in time zones far from UTC', () => {
    const reset = { weekday: 'tuesday', time: '08:00', timeZone: 'America/Los_Angeles' };
    // 2026-11-11 03:00 UTC is Tuesday 2026-11-10 19:00 in Los Angeles (UTC-8).
    expect(raidWeeksStart(1, reset, at('2026-11-11T03:00:00Z'))).toBe(
      seconds('2026-11-10T16:00:00Z'),
    );
  });
});

describe('parseLocalDate', () => {
  it('returns the start of the day in the time zone', () => {
    expect(parseLocalDate('2026-11-10', 'UTC')).toBe(seconds('2026-11-10T00:00:00Z'));
    expect(parseLocalDate('2026-11-10', 'America/New_York')).toBe(seconds('2026-11-10T05:00:00Z'));
  });

  it('can return the start of a later day', () => {
    expect(parseLocalDate('2026-12-31', 'UTC', 1)).toBe(seconds('2027-01-01T00:00:00Z'));
  });

  it.each(['2026-02-30', '2026-13-01', '10/11/2026', 'soon', ''])('rejects "%s"', (text) => {
    expect(parseLocalDate(text, 'UTC')).toBeNull();
  });
});

describe('localDate', () => {
  it('formats the date in the time zone', () => {
    expect(localDate(seconds('2026-11-11T03:00:00Z'), 'UTC')).toBe('2026-11-11');
    expect(localDate(seconds('2026-11-11T03:00:00Z'), 'America/Los_Angeles')).toBe('2026-11-10');
  });
});
