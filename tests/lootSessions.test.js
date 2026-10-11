import { describe, expect, it } from 'vitest';
import { SESSION_GAP_SECONDS, splitIntoSessions } from '../src/loot/sessions.js';
import { fixtureAwards } from './helpers/loot.js';

const HOUR = 60 * 60;

describe('splitIntoSessions', () => {
  it('keeps a raid that runs past midnight in one session', () => {
    const sessions = splitIntoSessions(fixtureAwards());
    expect(sessions.map((session) => session.awards.length)).toEqual([7, 3]);
    expect(sessions[0].awards.at(-1)?.itemName).toBe("Bonereaver's Edge");
  });

  it('records when each session started and ended', () => {
    const [first] = splitIntoSessions(fixtureAwards());
    expect(first.startedAt).toBe(first.awards[0].awardedAt);
    expect(first.endedAt).toBe(first.awards.at(-1)?.awardedAt);
  });

  it('starts a new session after a gap of exactly the threshold', () => {
    const awards = [{ awardedAt: 0 }, { awardedAt: SESSION_GAP_SECONDS }];
    expect(splitIntoSessions(awards)).toHaveLength(2);
  });

  it('measures the gap from the previous award, not the session start', () => {
    const awards = [0, 5, 10, 15].map((hours) => ({ awardedAt: hours * HOUR }));
    expect(splitIntoSessions(awards)).toHaveLength(1);
  });

  it('returns no sessions for no awards', () => {
    expect(splitIntoSessions([])).toEqual([]);
  });
});
