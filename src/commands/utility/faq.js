import { MessageFlags, RESTJSONErrorCodes } from 'discord.js';
import { contentsMessage, DMS_CLOSED_NOTICE, visibleSections } from '../../faq/menu.js';
import { createMemberCommand } from '../../lib/command.js';
import { respond } from '../../lib/respond.js';
import { deferPrivate } from '../../loot/discord/privateReply.js';

export default {
  data: createMemberCommand('faq', 'Get answers to common questions about the bot by DM.'),

  help: {
    description:
      'DMs you answers to common questions about the bot: what it does and how to use it. ' +
      'Choose a section from the list in the DM; it keeps working, so you can keep the DM. You ' +
      "see only the sections about commands you can use.\n\nIf your DMs are closed, it's shown " +
      'privately here instead.',
    examples: [{ usage: '/faq', description: 'Get the FAQ by DM.' }],
  },

  canUse: () => true,

  async execute(interaction, { guild, member, guildConfig }) {
    const { faq, commands } = interaction.client;
    const sections = visibleSections(faq, commands, member, guildConfig);
    // Opening the DM channel and sending take two requests.
    await deferPrivate(interaction);

    let dm;
    try {
      dm = await interaction.user.send(contentsMessage({ faq, sections, guildId: guild.id }));
    } catch (error) {
      if (error.code !== RESTJSONErrorCodes.CannotSendMessagesToThisUser) throw error;
      await respond(interaction, {
        ...contentsMessage({ faq, sections, guildId: guild.id, notice: DMS_CLOSED_NOTICE }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await respond(interaction, {
      content: `I sent you the FAQ by DM: ${dm.url}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
