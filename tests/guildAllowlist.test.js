import { describe, expect, it, vi } from 'vitest';
import { prepareGuild } from '../src/handlers/guildAllowlist.js';
import { logger } from '../src/lib/logger.js';
import { GUILD_A, fakeClient, fakeGuild, makeBotConfig } from './helpers/fakes.js';

const UNLISTED = {
  name: 'Random server',
  id: '100000000000000009',
  officerRoleId: '200000000000000009',
};

function setup() {
  const allowed = fakeGuild(GUILD_A);
  const unlisted = fakeGuild(UNLISTED);
  fakeClient({ botConfig: makeBotConfig(GUILD_A), guilds: [allowed, unlisted] });
  return { allowed, unlisted };
}

describe('prepareGuild', () => {
  it('leaves a guild that is not allowlisted and logs a warning', async () => {
    const { unlisted } = setup();
    const warn = vi.spyOn(logger, 'warn');
    await prepareGuild(unlisted);
    expect(unlisted.leave).toHaveBeenCalledOnce();
    expect(unlisted.members.fetch).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: UNLISTED.id }),
      expect.stringContaining('not on the allowlist'),
    );
  });

  it('stays in an allowlisted guild and caches its members', async () => {
    const { allowed } = setup();
    await prepareGuild(allowed);
    expect(allowed.leave).not.toHaveBeenCalled();
    expect(allowed.members.fetch).toHaveBeenCalledOnce();
  });

  it('logs instead of throwing when leaving fails', async () => {
    const { unlisted } = setup();
    unlisted.leave.mockRejectedValueOnce(new Error('network'));
    const error = vi.spyOn(logger, 'error');
    await expect(prepareGuild(unlisted)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });

  it('logs instead of throwing when caching members fails', async () => {
    const { allowed } = setup();
    allowed.members.fetch.mockRejectedValueOnce(new Error('timeout'));
    const error = vi.spyOn(logger, 'error');
    await expect(prepareGuild(allowed)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});
