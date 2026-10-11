import { MessageFlags } from 'discord.js';
import { createOfficerCommand } from '../../lib/command.js';
import { respond } from '../../lib/respond.js';

export default {
  data: createOfficerCommand('ping', 'Check that the bot is online and responding.'),
  help: {
    description:
      'Checks that the bot is online and responding, and shows its latency to Discord and the ' +
      'server the command ran for. The reply is visible only to you.',
    examples: [{ usage: '/ping', description: 'Check that the bot is online.' }],
  },
  async execute(interaction, { guild }) {
    const ping = interaction.client.ws.ping;
    const latency = ping >= 0 ? `${ping}ms` : 'not measured yet';
    await respond(interaction, {
      content: `Pong! Gateway latency: ${latency}. Server: **${guild.name}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
