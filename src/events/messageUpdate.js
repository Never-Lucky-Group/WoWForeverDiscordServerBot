import { Events } from 'discord.js';
import { redactMessage } from '../handlers/redactedWords.js';
import { logger } from '../lib/logger.js';

// Edits to messages that are not cached arrive thanks to the Message partial on the client.
export default {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.inGuild()) return;

    let message = newMessage;
    if (message.partial) {
      try {
        message = await message.fetch();
      } catch (error) {
        logger.error(
          { guildId: message.guildId, messageId: message.id, err: error },
          'Failed to fetch edited message',
        );
        return;
      }
    }

    if (message.author.bot) return;
    // Loading link embeds also fires messageUpdate; only re-check when the text changed. An
    // uncached message has no old content, so it is always checked.
    if (!oldMessage.partial && oldMessage.content === message.content) return;
    await redactMessage(message);
  },
};
