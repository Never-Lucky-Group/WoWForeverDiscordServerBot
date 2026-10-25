import { describe, expect, it } from 'vitest';
import { fillTitle, titleProblem } from '../src/raids/titles.js';

describe('fillTitle', () => {
  it('fills in the date and weekday', () => {
    expect(fillTitle('Molten Core {date}', '2026-11-04')).toBe('Molten Core 11/4');
    expect(fillTitle('{day} {date} MC', '2026-11-11')).toBe('Wed 11/11 MC');
    expect(fillTitle('MC { Date } {DAY}', '2026-12-31')).toBe('MC 12/31 Thu');
  });

  it('leaves a title without placeholders, or with unknown ones, as it is', () => {
    expect(fillTitle('Molten Core', '2026-11-04')).toBe('Molten Core');
    expect(fillTitle('MC {week}', '2026-11-04')).toBe('MC {week}');
  });
});

describe('titleProblem', () => {
  it('accepts titles with known placeholders', () => {
    expect(titleProblem('Molten Core {day} {date}')).toBeNull();
    expect(titleProblem('Molten Core')).toBeNull();
  });

  it('refuses an unknown placeholder, naming it', () => {
    expect(titleProblem('Molten Core {dat}')).toMatch(/^The title has \{dat\}, which the bot/);
  });

  it('refuses a title too long once the date is filled in', () => {
    expect(titleProblem(`${'x'.repeat(95)}{date}`)).toBeNull();
    expect(titleProblem(`${'x'.repeat(96)}{date}`)).toMatch(/up to 100 characters/);
  });
});
