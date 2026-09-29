import { Collection } from 'discord.js';
import { vi } from 'vitest';

// Minimal stand-ins for discord.js objects: only the properties the bot's code reads.

export const GUILD_A = {
  name: 'Guild A',
  id: '100000000000000001',
  officerRoleId: '200000000000000001',
};
export const GUILD_B = {
  name: 'Guild B',
  id: '100000000000000002',
  officerRoleId: '200000000000000002',
};
export const USER_ID = '300000000000000001';

export function makeBotConfig(...guilds) {
  return { guilds: new Map(guilds.map((guild) => [guild.id, guild])) };
}

export function fakeMember(userId, roleIds = [], { bot = false, guild } = {}) {
  return {
    id: userId,
    user: { id: userId, bot },
    guild,
    roles: {
      cache: new Collection(roleIds.map((roleId) => [roleId, { id: roleId }])),
      add: vi.fn(() => Promise.resolve()),
    },
  };
}

// `roles` are the guild's roles, e.g. [{ id, editable }].
export function fakeGuild(config, members = [], roles = []) {
  const cache = new Collection(members.map((member) => [member.id, member]));
  return {
    id: config.id,
    name: config.name ?? 'Unnamed guild',
    client: undefined,
    members: { cache, fetch: vi.fn(() => Promise.resolve(cache)) },
    roles: { cache: new Collection(roles.map((role) => [role.id, role])) },
    leave: vi.fn(() => Promise.resolve()),
  };
}

export function fakeClient({ botConfig, guilds = [], commands = [] }) {
  const client = {
    botConfig,
    commands: new Collection(commands.map((command) => [command.data.name, command])),
    guilds: { cache: new Collection(guilds.map((guild) => [guild.id, guild])) },
    ws: { ping: 42 },
  };
  for (const guild of guilds) guild.client = client;
  return client;
}
