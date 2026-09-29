import { describe, expect, it, vi } from 'vitest';
import { prepareGuild } from '../src/handlers/guildAllowlist.js';
import { assignJoinRole, checkJoinRole } from '../src/handlers/joinRole.js';
import { logger } from '../src/lib/logger.js';
import {
  GUILD_A,
  GUILD_B,
  USER_ID,
  fakeClient,
  fakeGuild,
  fakeMember,
  makeBotConfig,
} from './helpers/fakes.js';

const JOIN_ROLE_ID = '400000000000000001';
const GUILD_WITH_JOIN_ROLE = { ...GUILD_A, joinRoleId: JOIN_ROLE_ID };

const UNLISTED = {
  name: 'Random server',
  id: '100000000000000009',
  officerRoleId: '200000000000000009',
  joinRoleId: '400000000000000009',
};

// A member who just joined `config`'s guild; GUILD_B is allowlisted without a join role.
function joinedMember(config, { bot = false } = {}) {
  const guild = fakeGuild(config);
  fakeClient({ botConfig: makeBotConfig(GUILD_WITH_JOIN_ROLE, GUILD_B), guilds: [guild] });
  return fakeMember(USER_ID, [], { bot, guild });
}

describe('assignJoinRole', () => {
  it('gives the join role to a human who joins', async () => {
    const member = joinedMember(GUILD_WITH_JOIN_ROLE);
    await assignJoinRole(member);
    expect(member.roles.add).toHaveBeenCalledExactlyOnceWith(JOIN_ROLE_ID, expect.any(String));
  });

  it('skips bots', async () => {
    const member = joinedMember(GUILD_WITH_JOIN_ROLE, { bot: true });
    await assignJoinRole(member);
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('skips guilds without a join role', async () => {
    const member = joinedMember(GUILD_B);
    await assignJoinRole(member);
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('skips guilds that are not allowlisted', async () => {
    const member = joinedMember(UNLISTED);
    await assignJoinRole(member);
    expect(member.roles.add).not.toHaveBeenCalled();
  });

  it('logs instead of throwing when adding the role fails', async () => {
    const member = joinedMember(GUILD_WITH_JOIN_ROLE);
    member.roles.add.mockRejectedValueOnce(new Error('Missing Permissions'));
    const error = vi.spyOn(logger, 'error');
    await expect(assignJoinRole(member)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ guildId: GUILD_A.id, userId: USER_ID, roleId: JOIN_ROLE_ID }),
      expect.stringContaining('Failed to give join role'),
    );
  });
});

describe('checkJoinRole', () => {
  it('does not warn when the bot can assign the join role', () => {
    const guild = fakeGuild(GUILD_WITH_JOIN_ROLE, [], [{ id: JOIN_ROLE_ID, editable: true }]);
    const warn = vi.spyOn(logger, 'warn');
    checkJoinRole(guild, GUILD_WITH_JOIN_ROLE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('does nothing for a guild without a join role', () => {
    const guild = fakeGuild(GUILD_B);
    const warn = vi.spyOn(logger, 'warn');
    checkJoinRole(guild, GUILD_B);
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the join role does not exist', () => {
    const guild = fakeGuild(GUILD_WITH_JOIN_ROLE);
    const warn = vi.spyOn(logger, 'warn');
    checkJoinRole(guild, GUILD_WITH_JOIN_ROLE);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: JOIN_ROLE_ID }),
      expect.stringContaining('does not exist'),
    );
  });

  it('warns when the bot cannot assign the join role', () => {
    const guild = fakeGuild(GUILD_WITH_JOIN_ROLE, [], [{ id: JOIN_ROLE_ID, editable: false }]);
    const warn = vi.spyOn(logger, 'warn');
    checkJoinRole(guild, GUILD_WITH_JOIN_ROLE);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: JOIN_ROLE_ID }),
      expect.stringContaining('cannot assign'),
    );
  });

  it('runs when an allowlisted guild is prepared', async () => {
    const guild = fakeGuild(GUILD_WITH_JOIN_ROLE);
    fakeClient({ botConfig: makeBotConfig(GUILD_WITH_JOIN_ROLE), guilds: [guild] });
    const warn = vi.spyOn(logger, 'warn');
    await prepareGuild(guild);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: JOIN_ROLE_ID }),
      expect.stringContaining('does not exist'),
    );
  });
});
