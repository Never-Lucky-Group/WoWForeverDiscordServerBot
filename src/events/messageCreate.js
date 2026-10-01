import { Events } from 'discord.js';
import { handleDirectMessage } from '../handlers/directMessage.js';
import { redactMessage } from '../handlers/redactedWords.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    if (message.inGuild()) {
      await redactMessage(message);
      return;
    }
    await handleDirectMessage(message);
  },
};
