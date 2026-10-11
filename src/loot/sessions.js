// A gap this long between two awards starts a new raid session. Long enough for breaks and raids
// that run past midnight; a raid finished on another evening becomes its own session.
export const SESSION_GAP_SECONDS = 6 * 60 * 60;

// Splits awards (sorted oldest first) into sessions: [{ startedAt, endedAt, awards }].
export function splitIntoSessions(awards) {
  const sessions = [];
  let current;
  for (const award of awards) {
    if (!current || award.awardedAt - current.endedAt >= SESSION_GAP_SECONDS) {
      current = { startedAt: award.awardedAt, endedAt: award.awardedAt, awards: [] };
      sessions.push(current);
    }
    current.awards.push(award);
    current.endedAt = award.awardedAt;
  }
  return sessions;
}
