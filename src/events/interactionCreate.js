import { Events } from 'discord.js';
import { handleChatInputCommand } from '../handlers/commandInteraction.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Component interactions (e.g. the DM server picker, when DM commands are enabled) are handled
    // by their own collectors.
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction);
    }
  },
};
