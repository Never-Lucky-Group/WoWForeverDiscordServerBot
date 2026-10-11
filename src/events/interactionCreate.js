import { Events } from 'discord.js';
import { handleAutocomplete, handleChatInputCommand } from '../handlers/commandInteraction.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Component interactions (e.g. the DM server picker, when DM commands are enabled, or the
    // loot commands' buttons) are handled by their own collectors.
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
    }
  },
};
