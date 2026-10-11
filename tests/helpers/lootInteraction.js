import { EventEmitter } from 'node:events';
import { vi } from 'vitest';
import { GUILD_A, USER_ID, fakeMember } from './fakes.js';

export const LOOT_ROLE_ID = '500000000000000001';

export const LOOT_GUILD = {
  ...GUILD_A,
  lootRoleId: LOOT_ROLE_ID,
  raids: ['Molten Core', 'Onyxia'],
};

// Stands in for discord.js's InteractionCollector: tests emit 'collect' themselves.
export class FakeCollector extends EventEmitter {
  ended = false;
  stop(reason = 'user') {
    if (this.ended) return;
    this.ended = true;
    this.emit('end', new Map(), reason);
  }
}

// Options for one /loot subcommand, e.g. fakeOptions('character', { name: 'Thrall' }).
export function fakeOptions(subcommand, values = {}, { group = null, focused } = {}) {
  const get = (name, required) => {
    if (values[name] === undefined) {
      if (required) throw new Error(`Missing required option ${name}`);
      return null;
    }
    return values[name];
  };
  return {
    getSubcommand: () => subcommand,
    getSubcommandGroup: () => group,
    getString: get,
    getInteger: get,
    getAttachment: get,
    getFocused: () => focused,
  };
}

// A component interaction (button press or dropdown choice) from `userId`.
export function fakeComponent(customId, { values, userId = USER_ID } = {}) {
  return {
    customId,
    values,
    user: { id: userId },
    isStringSelectMenu: () => values !== undefined,
    update: vi.fn(() => Promise.resolve()),
    deferUpdate: vi.fn(() => Promise.resolve()),
    reply: vi.fn(() => Promise.resolve()),
  };
}

// A /loot interaction from a member holding `roles`. `message` is the message every reply
// returns; its collector is in `collectors`.
export function fakeLootInteraction({
  store,
  options,
  roles = [GUILD_A.officerRoleId, LOOT_ROLE_ID],
  guildConfig = LOOT_GUILD,
}) {
  const collectors = [];
  const message = {
    id: '600000000000000001',
    createMessageComponentCollector: vi.fn(() => {
      const collector = new FakeCollector();
      collectors.push(collector);
      return collector;
    }),
    awaitMessageComponent: vi.fn(),
  };
  const interaction = {
    id: '400000000000000001',
    commandName: 'loot',
    user: { id: USER_ID },
    client: { lootStore: store },
    options,
    replied: false,
    deferred: false,
    responded: false,
    reply: vi.fn(() => {
      interaction.replied = true;
      return Promise.resolve({ resource: { message } });
    }),
    deferReply: vi.fn(() => {
      interaction.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn(() => {
      interaction.replied = true;
      return Promise.resolve(message);
    }),
    followUp: vi.fn(() => Promise.resolve(message)),
    respond: vi.fn(() => {
      interaction.responded = true;
      return Promise.resolve();
    }),
  };
  const member = fakeMember(USER_ID, roles);
  const context = { guild: { id: guildConfig.id, name: 'Guild A' }, member, guildConfig };
  return { interaction, context, message, collectors };
}

// The options of the most recent reply, edit or follow-up sent through `interaction`.
export function lastMessage(interaction) {
  const calls = [];
  for (const fn of [interaction.reply, interaction.editReply, interaction.followUp]) {
    fn.mock.calls.forEach(([options], index) => {
      calls.push({ order: fn.mock.invocationCallOrder[index], options });
    });
  }
  return calls.sort((a, b) => a.order - b.order).at(-1)?.options;
}
