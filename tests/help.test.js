import { Collection, MessageFlags } from 'discord.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import help, { notFoundMessage } from '../src/commands/utility/help.js';
import { createOfficerCommand } from '../src/lib/command.js';
import { EMBED_LIMITS, commandTree, helpPageEmbed } from '../src/lib/help.js';
import { loadCommands } from '../src/loaders/commands.js';
import { GUILD_A, USER_ID, fakeMember } from './helpers/fakes.js';
import { LOOT_GUILD, LOOT_ROLE_ID } from './helpers/lootInteraction.js';

const OFFICER = [GUILD_A.officerRoleId];
const LOOT_OFFICER = [GUILD_A.officerRoleId, LOOT_ROLE_ID];

let commands;
beforeAll(async () => {
  commands = await loadCommands();
});

function setup({ roles = LOOT_OFFICER, command = null, focused = '', extraCommands = [] } = {}) {
  const allCommands = new Collection(commands);
  for (const extra of extraCommands) allCommands.set(extra.data.name, extra);
  const interaction = {
    client: { commands: allCommands },
    options: { getString: () => command, getFocused: () => focused },
    replied: false,
    deferred: false,
    reply: vi.fn(() => Promise.resolve()),
    followUp: vi.fn(() => Promise.resolve()),
    respond: vi.fn(() => Promise.resolve()),
  };
  const context = { member: fakeMember(USER_ID, roles), guildConfig: LOOT_GUILD };
  return { interaction, context };
}

async function run(options) {
  const { interaction, context } = setup(options);
  await help.execute(interaction, context);
  const sent = interaction.reply.mock.calls[0][0];
  return { sent, embed: sent.embeds?.[0].toJSON() };
}

async function suggest(options) {
  const { interaction, context } = setup(options);
  await help.autocomplete(interaction, context);
  return interaction.respond.mock.calls[0][0];
}

function embedLength(embed) {
  return (
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

describe('/help definition', () => {
  it('registers as a server command every member can see and use', () => {
    const json = help.data.toJSON();
    expect(json).toMatchObject({ name: 'help', contexts: [0], integration_types: [0] });
    expect(json.default_member_permissions).toBeUndefined();
    expect(json.options).toMatchObject([{ name: 'command', required: false, autocomplete: true }]);
    expect(help.canUse(fakeMember(USER_ID), GUILD_A)).toBe(true);
  });
});

describe('/help without a command', () => {
  it('lists the commands the member can use, privately', async () => {
    const { sent, embed } = await run();
    expect(sent.flags).toBe(MessageFlags.Ephemeral);
    expect(embed.title).toBe('Commands');
    expect(embed.description.split('\n')).toEqual([
      '`/help` — List the commands you can use and how to use them.',
      '`/loot` — Import Gargul loot exports and look up who got what.',
      '`/ping` — Check that the bot is online and responding.',
    ]);
  });

  it('hides /loot from Officers without the loot role', async () => {
    const { embed } = await run({ roles: OFFICER });
    expect(embed.description).not.toContain('/loot');
    expect(embed.description).toContain('/ping');
  });

  it('shows only /help to members who are not Officers', async () => {
    const { embed } = await run({ roles: [] });
    expect(embed.description.split('\n')).toEqual([
      '`/help` — List the commands you can use and how to use them.',
    ]);
  });

  it('treats a blank command as no command', async () => {
    const { embed } = await run({ command: '   ' });
    expect(embed.title).toBe('Commands');
  });
});

describe('/help with a command', () => {
  it('lists the subcommands of a command with their usage', async () => {
    const { sent, embed } = await run({ command: 'loot' });
    expect(sent.flags).toBe(MessageFlags.Ephemeral);
    expect(embed.title).toBe('/loot');
    expect(embed.description).toContain('Gargul');
    expect(embed.fields.map((field) => field.name)).toEqual([
      '/loot import file',
      '/loot imports list',
      '/loot imports delete id',
      '/loot imports replace id file',
      '/loot character name [weeks] [raid] [from] [to] [type]',
      '/loot item name [weeks] [raid] [from] [to]',
      '/loot raid session',
      '/loot leaderboard [weeks] [raid] [from] [to] [type]',
      'Examples',
    ]);
    expect(embed.fields[4].value).toBe('Items a character received.');
    expect(embed.footer.text).toContain('/help command:loot <subcommand>');
  });

  it('lists the subcommands of a subcommand group', async () => {
    const { embed } = await run({ command: 'loot imports' });
    expect(embed.title).toBe('/loot imports');
    expect(embed.fields.map((field) => field.name)).toEqual([
      '/loot imports list',
      '/loot imports delete id',
      '/loot imports replace id file',
    ]);
  });

  it('describes a subcommand with its usage, options and examples', async () => {
    const { embed } = await run({ command: 'loot character' });
    expect(embed.title).toBe('/loot character');
    expect(embed.description).toContain('without -Realm');
    expect(embed.fields.map((field) => field.name)).toEqual(['Usage', 'Options', 'Examples']);
    expect(embed.fields[0].value).toBe('`/loot character name [weeks] [raid] [from] [to] [type]`');

    const options = embed.fields[1].value.split('\n\n');
    expect(options[0]).toBe('`name` · text · required\nCharacter name, optionally with -Realm');
    expect(options[1]).toBe(
      '`weeks` · whole number, 1–520 · optional\n' +
        'Only the last N raid weeks (1 = since the most recent reset)',
    );
    expect(options[5]).toContain(
      'One of: Main spec, Off spec, Soft reserved, Wishlisted, Prioritized, Bonus roll',
    );
    expect(embed.fields[2].value).toContain('`/loot character name:Thrall`');
  });

  it('describes a command without subcommands', async () => {
    const { embed } = await run({ command: 'ping' });
    expect(embed.title).toBe('/ping');
    expect(embed.fields.map((field) => field.name)).toEqual(['Usage', 'Examples']);
    expect(embed.fields[0].value).toBe('`/ping`');
  });

  it('accepts a leading slash, any case and extra spaces', async () => {
    const { embed } = await run({ command: '  /LOOT   imports  delete ' });
    expect(embed.title).toBe('/loot imports delete');
  });

  it.each([
    ['an unknown command', 'nope', LOOT_OFFICER],
    ['an unknown subcommand', 'loot nope', LOOT_OFFICER],
    ['too many words', 'loot character extra', LOOT_OFFICER],
    ['a command the member cannot use', 'loot', OFFICER],
    ['a subcommand of a command the member cannot use', 'loot character', OFFICER],
  ])('gives the same answer for %s', async (_label, command, roles) => {
    const { sent } = await run({ command, roles });
    expect(sent).toEqual({ content: notFoundMessage(command), flags: MessageFlags.Ephemeral });
  });

  it('keeps backticks in the name from breaking the reply', () => {
    expect(notFoundMessage(' `x` ')).toBe(
      "No command named `'x'`. Use /help to list the commands you can use.",
    );
    expect(notFoundMessage('``')).toBe(
      "No command named `''`. Use /help to list the commands you can use.",
    );
  });

  it('uses the short description for a command without help text', async () => {
    const plain = {
      data: createOfficerCommand('plain', 'A command without help text.'),
      execute: () => Promise.resolve(),
    };
    const { embed } = await run({ command: 'plain', extraCommands: [plain] });
    expect(embed.description).toBe('A command without help text.');
    expect(embed.fields.map((field) => field.name)).toEqual(['Usage']);
  });
});

describe('/help autocomplete', () => {
  it('suggests every command and subcommand the member can use', async () => {
    const choices = await suggest();
    expect(choices.map((choice) => choice.value)).toEqual([
      'help',
      'loot',
      'loot import',
      'loot imports',
      'loot imports list',
      'loot imports delete',
      'loot imports replace',
      'loot character',
      'loot item',
      'loot raid',
      'loot leaderboard',
      'ping',
    ]);
    expect(choices[1].name).toBe('/loot — Import Gargul loot exports and look up who got what.');
  });

  it('filters by the typed text', async () => {
    const choices = await suggest({ focused: '/Loot imp' });
    expect(choices.map((choice) => choice.value)).toEqual([
      'loot import',
      'loot imports',
      'loot imports list',
      'loot imports delete',
      'loot imports replace',
    ]);
  });

  it('never suggests commands the member cannot use', async () => {
    const choices = await suggest({ roles: OFFICER, focused: 'loot' });
    expect(choices).toEqual([]);
  });

  it('suggests at most 25 choices of at most 100 characters', async () => {
    const big = createOfficerCommand('big', 'x'.repeat(100));
    for (let i = 0; i < 25; i += 1) {
      big.addSubcommand((subcommand) =>
        subcommand.setName(`sub${i}`).setDescription('y'.repeat(100)),
      );
    }
    const choices = await suggest({
      extraCommands: [{ data: big, execute: () => Promise.resolve() }],
      focused: 'big',
    });
    expect(choices).toHaveLength(25);
    for (const choice of choices) expect(choice.name.length).toBeLessThanOrEqual(100);
  });
});

describe('help pages', () => {
  it('describes one-sided number ranges and falls back from an empty description', () => {
    const data = createOfficerCommand('range', 'Short description.')
      .addIntegerOption((option) => option.setName('low').setDescription('Low').setMinValue(1))
      .addNumberOption((option) => option.setName('high').setDescription('High').setMaxValue(9));
    const embed = helpPageEmbed(commandTree({ data, help: { description: '' } })).toJSON();
    expect(embed.description).toBe('Short description.');
    expect(embed.fields[1].value).toBe(
      '`low` · whole number, at least 1 · optional\nLow\n\n`high` · number, at most 9 · optional\nHigh',
    );
  });

  it('stay within Discord embed limits however long the help text is', () => {
    const data = createOfficerCommand('long', 'Long help.');
    for (let i = 0; i < 25; i += 1) {
      data.addSubcommand((subcommand) =>
        subcommand.setName(`sub${i}`).setDescription('d'.repeat(100)),
      );
    }
    const command = {
      data,
      execute: () => Promise.resolve(),
      help: {
        description: 'x'.repeat(10_000),
        examples: Array.from({ length: 50 }, () => ({
          usage: '/long',
          description: 'e'.repeat(50),
        })),
      },
    };

    const embed = helpPageEmbed(commandTree(command)).toJSON();
    expect(embed.description.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    expect(embed.fields.length).toBeLessThanOrEqual(25);
    for (const field of embed.fields) {
      expect(field.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    }
    expect(embedLength(embed)).toBeLessThanOrEqual(EMBED_LIMITS.total);
  });

  it('fit within the limits for every real command and subcommand', () => {
    const nodes = (node) => [node, ...node.children.flatMap(nodes)];
    for (const command of commands.values()) {
      for (const node of nodes(commandTree(command))) {
        const embed = helpPageEmbed(node).toJSON();
        expect(embed.description, node.path).not.toMatch(/…$/);
        for (const field of embed.fields ?? []) expect(field.value, node.path).not.toMatch(/…$/);
        expect(embedLength(embed), node.path).toBeLessThanOrEqual(EMBED_LIMITS.total);
      }
    }
  });

  it('only has help text for subcommands that exist', () => {
    for (const command of commands.values()) {
      const tree = commandTree(command);
      const paths = new Set(
        [tree, ...tree.children.flatMap((child) => [child, ...child.children])].map((node) =>
          node.path.split(' ').slice(1).join(' '),
        ),
      );
      for (const key of Object.keys(command.help?.subcommands ?? {})) {
        expect(paths, `${command.data.name}: ${key}`).toContain(key);
      }
    }
  });
});
