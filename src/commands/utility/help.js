import { MessageFlags } from 'discord.js';
import { createMemberCommand } from '../../lib/command.js';
import {
  commandListEmbed,
  findHelpTarget,
  helpChoices,
  helpPageEmbed,
  usableCommands,
} from '../../lib/help.js';
import { respond } from '../../lib/respond.js';

const TARGET_MAX_LENGTH = 100;

// The same reply for commands that do not exist and commands the member may not use, so /help
// never reveals hidden commands.
export function notFoundMessage(text) {
  const name = text.trim().replaceAll('`', "'").slice(0, TARGET_MAX_LENGTH);
  return `No command named \`${name}\`. Use /help to list the commands you can use.`;
}

export default {
  data: createMemberCommand(
    'help',
    'List the commands you can use and how to use them.',
  ).addStringOption((option) =>
    option
      .setName('command')
      .setDescription('A command or subcommand, e.g. "loot" or "loot character"')
      .setMaxLength(TARGET_MAX_LENGTH)
      .setAutocomplete(true),
  ),

  help: {
    description:
      'Without `command`, lists every command you can use with a short description. With ' +
      '`command`, shows a command or subcommand in detail: what it does, its options and ' +
      'examples.\n\nOnly commands you can use are listed. Replies are visible only to you.',
    examples: [
      { usage: '/help', description: 'List the commands you can use.' },
      { usage: '/help command:loot', description: 'Describe /loot and its subcommands.' },
      {
        usage: '/help command:loot character',
        description: 'Describe /loot character and its options.',
      },
    ],
  },

  canUse: () => true,

  async execute(interaction, { member, guildConfig }) {
    const commands = usableCommands(interaction.client.commands, member, guildConfig);
    const text = interaction.options.getString('command') ?? '';

    if (!text.trim()) {
      await respond(interaction, {
        embeds: [commandListEmbed(commands)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const node = findHelpTarget(commands, text);
    await respond(
      interaction,
      node
        ? { embeds: [helpPageEmbed(node)], flags: MessageFlags.Ephemeral }
        : { content: notFoundMessage(text), flags: MessageFlags.Ephemeral },
    );
  },

  async autocomplete(interaction, { member, guildConfig }) {
    const commands = usableCommands(interaction.client.commands, member, guildConfig);
    await interaction.respond(helpChoices(commands, interaction.options.getFocused()));
  },
};
