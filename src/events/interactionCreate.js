import { Events } from 'discord.js';
import { FAQ_PREFIX, handleFaqSelect } from '../faq/menu.js';
import { handleAutocomplete, handleChatInputCommand } from '../handlers/commandInteraction.js';
import { logger } from '../lib/logger.js';
import { RSVP_PREFIX, handleRsvpButton } from '../raids/rsvp.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Other component interactions (e.g. the DM server picker, when DM commands are enabled, or
    // the loot commands' buttons) are handled by their own collectors.
    if (interaction.isChatInputCommand()) {
      await handleChatInputCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      await handleAutocomplete(interaction);
    } else if (interaction.isButton() && interaction.customId.startsWith(`${RSVP_PREFIX}:`)) {
      // The member DM buttons outlive any collector, so they are routed here.
      try {
        await handleRsvpButton(interaction);
      } catch (error) {
        logger.error({ err: error, userId: interaction.user.id }, 'DM answer button failed');
      }
    } else if (
      interaction.isStringSelectMenu() &&
      interaction.customId.startsWith(`${FAQ_PREFIX}:`)
    ) {
      // So does the /faq section dropdown.
      try {
        await handleFaqSelect(interaction);
      } catch (error) {
        logger.error({ err: error, userId: interaction.user.id }, 'FAQ section dropdown failed');
      }
    }
  },
};
