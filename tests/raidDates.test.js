import { describe, expect, it } from 'vitest';
import { addDaysToDate, localTimeToSeconds, weekdayOfDate } from '../src/lib/time.js';
import {
  formatDate,
  formatDateRange,
  formatTime,
  parseDateInput,
  parseTimeInput,
  todayIn,
} from '../src/raids/dates.js';

const seconds = (iso) => Date.parse(iso) / 1000;
// Saturday 2026-10-24, midday UTC.
const NOW = Date.parse('2026-10-24T12:00:00Z');

describe('parseDateInput', () => {
  it.each([
    ['2026-11-04', '2026-11-04'],
    [' 2026-11-04 ', '2026-11-04'],
    ['11/4', '2026-11-04'],
    ['11/4/2026', '2026-11-04'],
    ['Nov 4', '2026-11-04'],
    ['nov. 4', '2026-11-04'],
    ['November 4th', '2026-11-04'],
    ['November 4th, 2026', '2026-11-04'],
    ['Wed Nov 4, 2026', '2026-11-04'],
    ['4 November', '2026-11-04'],
    ['4th of Nov 2027', '2027-11-04'],
    ['Sept 3', '2027-09-03'],
  ])('reads "%s" as %s', (text, expected) => {
    expect(parseDateInput(text, 'UTC', NOW)).toBe(expected);
  });

  it('reads numeric dates month first', () => {
    expect(parseDateInput('1/2', 'UTC', NOW)).toBe('2027-01-02');
  });

  it('uses today for a date without a year that is today', () => {
    expect(parseDateInput('Oct 24', 'UTC', NOW)).toBe('2026-10-24');
  });

  it('uses next year for a date without a year that has passed', () => {
    expect(parseDateInput('Oct 23', 'UTC', NOW)).toBe('2027-10-23');
  });

  it("decides what today is in the server's time zone", () => {
    // 2026-10-24 12:00 UTC is already 2026-10-25 in Auckland (UTC+13).
    expect(parseDateInput('Oct 24', 'Pacific/Auckland', NOW)).toBe('2027-10-24');
  });

  it('can read a date without a year relative to another date', () => {
    expect(parseDateInput('Jan 3', 'UTC', NOW, { onOrAfter: '2027-12-28' })).toBe('2028-01-03');
    expect(parseDateInput('Oct 20', 'UTC', NOW, { onOrAfter: '2026-10-19' })).toBe('2026-10-20');
    expect(parseDateInput('2026-01-01', 'UTC', NOW, { onOrAfter: '2026-10-19' })).toBe(
      '2026-01-01',
    );
  });

  it('finds the next February 29 for a date without a year', () => {
    expect(parseDateInput('2/29', 'UTC', NOW)).toBe('2028-02-29');
  });

  it.each(['13/1', '2/30/2026', '2026-02-30', 'Ma 4', 'Smarch 4', 'soon', '', 'Nov'])(
    'rejects "%s"',
    (text) => {
      expect(parseDateInput(text, 'UTC', NOW)).toBeNull();
    },
  );
});

describe('parseTimeInput', () => {
  it.each([
    ['19:30', '19:30'],
    ['7:05', '07:05'],
    [' 00:00 ', '00:00'],
  ])('reads "%s" as %s', (text, expected) => {
    expect(parseTimeInput(text)).toBe(expected);
  });

  it.each(['24:00', '19:60', '7pm', '1930', ''])('rejects "%s"', (text) => {
    expect(parseTimeInput(text)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats dates and ranges', () => {
    expect(formatDate('2026-11-04')).toBe('Wed Nov 4, 2026');
    expect(formatDateRange('2026-11-04', '2026-11-04')).toBe('Wed Nov 4, 2026');
    expect(formatDateRange('2026-11-04', '2026-11-06')).toBe('Wed Nov 4, 2026 – Fri Nov 6, 2026');
  });

  it('formats times in the time zone', () => {
    expect(formatTime(seconds('2026-11-04T19:30:00Z'), 'UTC')).toBe('19:30');
    expect(formatTime(seconds('2026-11-04T19:30:00Z'), 'America/New_York')).toBe('14:30');
  });

  it("gives today's date in the time zone", () => {
    expect(todayIn('UTC', NOW)).toBe('2026-10-24');
    expect(todayIn('Pacific/Auckland', NOW)).toBe('2026-10-25');
  });
});

describe('time helpers', () => {
  it('adds calendar days across months and years', () => {
    expect(addDaysToDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('gives the weekday of a date', () => {
    expect(weekdayOfDate('2026-11-04')).toBe(3);
  });

  it('converts a local time to Unix seconds across daylight saving changes', () => {
    // London is UTC+1 in summer time, which ended on 2026-10-25.
    expect(localTimeToSeconds('2026-10-21', '19:30', 'Europe/London')).toBe(
      seconds('2026-10-21T18:30:00Z'),
    );
    expect(localTimeToSeconds('2026-10-28', '19:30', 'Europe/London')).toBe(
      seconds('2026-10-28T19:30:00Z'),
    );
  });
});
