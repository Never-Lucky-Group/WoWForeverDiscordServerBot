import { describe, expect, it, vi } from 'vitest';
import {
  COMMAND_ERROR_MESSAGE,
  NO_PERMISSION_MESSAGE,
  PICKER_TIMEOUT_MESSAGE,
  handleAutocomplete,
  handleChatInputCommand,
} from '../src/handlers/commandInteraction.js';
import {
  GUILD_A,
  GUILD_B,
  USER_ID,
  fakeClient,
  fakeGuild,
  fakeMember,
  makeBotConfig,
} from './helpers/fakes.js';

const PICKER_CUSTOM_ID = 'guild-picker:400000000000000001';

function fakeCommand({ canUse } = {}) {
  return {
    data: { name: 'test', toJSON: () => ({ name: 'test', description: 'Test command' }) },
    execute: vi.fn(() => Promise.resolve()),
    canUse,
  };
}

function fakeInteraction({ client, guild, member, cached = true, commandName = 'test' }) {
  const pickerMessage = { awaitMessageComponent: vi.fn() };
  const interaction = {
    id: '400000000000000001',
    commandName,
    client,
    user: { id: USER_ID },
    guildId: guild?.id ?? null,
    guild: guild ?? null,
    member: member ?? null,
    replied: false,
    deferred: false,
    inGuild: () => guild !== undefined,
    inCachedGuild: () => guild !== undefined && cached,
    reply: vi.fn(() => {
      interaction.replied = true;
      return Promise.resolve({ resource: { message: pickerMessage } });
    }),
    followUp: vi.fn(() => Promise.resolve()),
    editReply: vi.fn(() => Promise.resolve()),
  };
  return { interaction, pickerMessage };
}

function fakeSelection(guildId) {
  return {
    customId: PICKER_CUSTOM_ID,
    user: { id: USER_ID },
    values: [guildId],
    update: vi.fn(() => Promise.resolve()),
  };
}

// Two allowlisted guilds; the user is a member of each one whose role list is not null.
function setupDm(rolesInA, rolesInB) {
  const command = fakeCommand();
  const memberA = rolesInA && fakeMember(USER_ID, rolesInA);
  const memberB = rolesInB && fakeMember(USER_ID, rolesInB);
  const guildA = fakeGuild(GUILD_A, memberA ? [memberA] : []);
  const guildB = fakeGuild(GUILD_B, memberB ? [memberB] : []);
  const client = fakeClient({
    botConfig: makeBotConfig(GUILD_A, GUILD_B),
    guilds: [guildA, guildB],
    commands: [command],
  });
  return { command, client, guildA, guildB, memberA, memberB, ...fakeInteraction({ client }) };
}

describe('handleChatInputCommand', () => {
  it('replies to an unknown command', async () => {
    const client = fakeClient({ botConfig: makeBotConfig(GUILD_A) });
    const { interaction } = fakeInteraction({ client, commandName: 'missing' });
    await handleChatInputCommand(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Unknown command.' }),
    );
  });

  describe('in a server', () => {
    function setupGuild({ roles, allowlisted = true, cached = true, canUse }) {
      const command = fakeCommand({ canUse });
      const member = fakeMember(USER_ID, roles);
      const guild = fakeGuild(GUILD_A, [member]);
      const client = fakeClient({
        botConfig: allowlisted ? makeBotConfig(GUILD_A) : makeBotConfig(GUILD_B),
        guilds: [guild],
        commands: [command],
      });
      const { interaction } = fakeInteraction({ client, guild, member, cached });
      return { command, guild, member, interaction };
    }

    it('runs the command for an Officer of that server', async () => {
      const { command, guild, member, interaction } = setupGuild({
        roles: [GUILD_A.officerRoleId],
      });
      await handleChatInputCommand(interaction);
      expect(command.execute).toHaveBeenCalledWith(interaction, {
        guild,
        member,
        guildConfig: GUILD_A,
      });
    });

    it.each([
      ['the user is not an Officer', { roles: [] }],
      ['the user only has another server’s Officer role', { roles: [GUILD_B.officerRoleId] }],
      ['the server is not allowlisted', { roles: [GUILD_A.officerRoleId], allowlisted: false }],
      ['the server is not cached', { roles: [GUILD_A.officerRoleId], cached: false }],
    ])('denies when %s', async (_label, options) => {
      const { command, interaction } = setupGuild(options);
      await handleChatInputCommand(interaction);
      expect(command.execute).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: NO_PERMISSION_MESSAGE }),
      );
    });

    it("runs a command for anyone its canUse allows, passing the member and server's config", async () => {
      const canUse = vi.fn(() => true);
      const { command, guild, member, interaction } = setupGuild({ roles: [], canUse });
      await handleChatInputCommand(interaction);
      expect(canUse).toHaveBeenCalledWith(member, GUILD_A);
      expect(command.execute).toHaveBeenCalledWith(interaction, {
        guild,
        member,
        guildConfig: GUILD_A,
      });
    });

    it('denies an Officer when the command’s canUse refuses', async () => {
      const { command, interaction } = setupGuild({
        roles: [GUILD_A.officerRoleId],
        canUse: () => false,
      });
      await handleChatInputCommand(interaction);
      expect(command.execute).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: NO_PERMISSION_MESSAGE }),
      );
    });

    it('still requires an allowlisted server for commands anyone can use', async () => {
      const { command, interaction } = setupGuild({
        roles: [],
        allowlisted: false,
        canUse: () => true,
      });
      await handleChatInputCommand(interaction);
      expect(command.execute).not.toHaveBeenCalled();
    });

    it('reports an error thrown by the command', async () => {
      const { command, interaction } = setupGuild({ roles: [GUILD_A.officerRoleId] });
      command.execute.mockRejectedValueOnce(new Error('boom'));
      await handleChatInputCommand(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: COMMAND_ERROR_MESSAGE }),
      );
    });

    it('does not throw if reporting the error also fails', async () => {
      const { command, interaction } = setupGuild({ roles: [GUILD_A.officerRoleId] });
      command.execute.mockRejectedValueOnce(new Error('boom'));
      interaction.reply.mockRejectedValueOnce(new Error('network'));
      await expect(handleChatInputCommand(interaction)).resolves.toBeUndefined();
    });
  });

  // DM commands are disabled for now (see createOfficerCommand in src/lib/command.js), but the
  // dispatcher keeps its DM path so they can be re-enabled; these tests keep it working.
  describe('in a DM', () => {
    it('denies a user who is not in any allowlisted server', async () => {
      const { command, interaction } = setupDm(null, null);
      await handleChatInputCommand(interaction);
      expect(command.execute).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: NO_PERMISSION_MESSAGE }),
      );
    });

    it('denies a member who is not an Officer anywhere', async () => {
      const { command, interaction } = setupDm([], []);
      await handleChatInputCommand(interaction);
      expect(command.execute).not.toHaveBeenCalled();
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: NO_PERMISSION_MESSAGE }),
      );
    });

    it("only offers servers where the command's canUse allows the user", async () => {
      const { command, interaction, guildA, memberA, pickerMessage } = setupDm([], []);
      command.canUse = (_member, guildConfig) => guildConfig.id === GUILD_A.id;
      await handleChatInputCommand(interaction);
      expect(pickerMessage.awaitMessageComponent).not.toHaveBeenCalled();
      expect(command.execute).toHaveBeenCalledWith(interaction, {
        guild: guildA,
        member: memberA,
        guildConfig: GUILD_A,
      });
    });

    it('runs directly when the user is an Officer in exactly one server', async () => {
      const { command, interaction, guildB, memberB, pickerMessage } = setupDm(
        [],
        [GUILD_B.officerRoleId],
      );
      await handleChatInputCommand(interaction);
      expect(pickerMessage.awaitMessageComponent).not.toHaveBeenCalled();
      expect(command.execute).toHaveBeenCalledWith(interaction, {
        guild: guildB,
        member: memberB,
        guildConfig: GUILD_B,
      });
    });

    describe('when the user is an Officer in several servers', () => {
      function setupPicker() {
        return setupDm([GUILD_A.officerRoleId], [GUILD_B.officerRoleId]);
      }

      it('asks which server to use, then runs the command there', async () => {
        const { command, interaction, guildB, memberB, pickerMessage } = setupPicker();
        const selection = fakeSelection(GUILD_B.id);
        pickerMessage.awaitMessageComponent.mockResolvedValueOnce(selection);

        await handleChatInputCommand(interaction);

        const picker = interaction.reply.mock.calls[0][0];
        const options = picker.components[0].toJSON().components[0].options;
        expect(options).toEqual([
          { label: GUILD_A.name, value: GUILD_A.id },
          { label: GUILD_B.name, value: GUILD_B.id },
        ]);
        expect(selection.update).toHaveBeenCalledWith(
          expect.objectContaining({ content: expect.stringContaining('Guild B') }),
        );
        expect(command.execute).toHaveBeenCalledWith(interaction, {
          guild: guildB,
          member: memberB,
          guildConfig: GUILD_B,
        });
      });

      it('only accepts picker selections from the user who ran the command', async () => {
        const { interaction, pickerMessage } = setupPicker();
        pickerMessage.awaitMessageComponent.mockResolvedValueOnce(fakeSelection(GUILD_A.id));
        await handleChatInputCommand(interaction);

        const { filter } = pickerMessage.awaitMessageComponent.mock.calls[0][0];
        expect(filter({ customId: PICKER_CUSTOM_ID, user: { id: USER_ID } })).toBe(true);
        expect(filter({ customId: PICKER_CUSTOM_ID, user: { id: '399999999999999999' } })).toBe(
          false,
        );
        expect(filter({ customId: 'guild-picker:other', user: { id: USER_ID } })).toBe(false);
      });

      it('cancels when no server is picked in time', async () => {
        const { command, interaction, pickerMessage } = setupPicker();
        pickerMessage.awaitMessageComponent.mockRejectedValueOnce(new Error('time'));
        await handleChatInputCommand(interaction);
        expect(command.execute).not.toHaveBeenCalled();
        expect(interaction.editReply).toHaveBeenCalledWith({
          content: PICKER_TIMEOUT_MESSAGE,
          components: [],
        });
      });

      it('denies if the Officer role was removed while the picker was open', async () => {
        const { command, interaction, pickerMessage, memberB } = setupPicker();
        const selection = fakeSelection(GUILD_B.id);
        pickerMessage.awaitMessageComponent.mockImplementationOnce(() => {
          memberB.roles.cache.delete(GUILD_B.officerRoleId);
          return Promise.resolve(selection);
        });
        await handleChatInputCommand(interaction);
        expect(command.execute).not.toHaveBeenCalled();
        expect(selection.update).toHaveBeenCalledWith({
          content: NO_PERMISSION_MESSAGE,
          components: [],
        });
      });

      it('reports a command error as a follow-up after the picker reply', async () => {
        const { command, interaction, pickerMessage } = setupPicker();
        pickerMessage.awaitMessageComponent.mockResolvedValueOnce(fakeSelection(GUILD_A.id));
        command.execute.mockRejectedValueOnce(new Error('boom'));
        await handleChatInputCommand(interaction);
        expect(interaction.followUp).toHaveBeenCalledWith(
          expect.objectContaining({ content: COMMAND_ERROR_MESSAGE }),
        );
      });
    });
  });
});

describe('handleAutocomplete', () => {
  function setupAutocomplete({
    roles = [GUILD_A.officerRoleId],
    autocomplete,
    inGuild = true,
    canUse,
  }) {
    const command = { ...fakeCommand({ canUse }), autocomplete };
    const member = fakeMember(USER_ID, roles);
    const guild = fakeGuild(GUILD_A, [member]);
    const client = fakeClient({
      botConfig: makeBotConfig(GUILD_A),
      guilds: [guild],
      commands: [command],
    });
    const interaction = {
      commandName: 'test',
      client,
      user: { id: USER_ID },
      guildId: inGuild ? guild.id : null,
      guild: inGuild ? guild : null,
      member: inGuild ? member : null,
      responded: false,
      inGuild: () => inGuild,
      inCachedGuild: () => inGuild,
      respond: vi.fn(() => Promise.resolve()),
    };
    return { command, guild, member, interaction };
  }

  it("passes Officers' requests to the command with the server context", async () => {
    const autocomplete = vi.fn(() => Promise.resolve());
    const { interaction, guild, member } = setupAutocomplete({ autocomplete });
    await handleAutocomplete(interaction);
    expect(autocomplete).toHaveBeenCalledWith(interaction, {
      guild,
      member,
      guildConfig: GUILD_A,
    });
  });

  it('suggests nothing to non-Officers', async () => {
    const autocomplete = vi.fn();
    const { interaction } = setupAutocomplete({ autocomplete, roles: [] });
    await handleAutocomplete(interaction);
    expect(autocomplete).not.toHaveBeenCalled();
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('follows the command’s canUse', async () => {
    const allowed = setupAutocomplete({
      autocomplete: vi.fn(() => Promise.resolve()),
      roles: [],
      canUse: () => true,
    });
    await handleAutocomplete(allowed.interaction);
    expect(allowed.command.autocomplete).toHaveBeenCalled();

    const refused = setupAutocomplete({ autocomplete: vi.fn(), canUse: () => false });
    await handleAutocomplete(refused.interaction);
    expect(refused.command.autocomplete).not.toHaveBeenCalled();
    expect(refused.interaction.respond).toHaveBeenCalledWith([]);
  });

  it('suggests nothing outside servers or for commands without autocomplete', async () => {
    const outside = setupAutocomplete({ autocomplete: vi.fn(), inGuild: false });
    await handleAutocomplete(outside.interaction);
    expect(outside.interaction.respond).toHaveBeenCalledWith([]);

    const none = setupAutocomplete({ autocomplete: undefined });
    await handleAutocomplete(none.interaction);
    expect(none.interaction.respond).toHaveBeenCalledWith([]);
  });

  it('answers with an empty list when the command fails', async () => {
    const { interaction } = setupAutocomplete({
      autocomplete: vi.fn(() => Promise.reject(new Error('boom'))),
    });
    await handleAutocomplete(interaction);
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });
});
