import { Events } from 'discord.js';
import { handleDirectMessage } from '../handlers/directMessage.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (message.author.bot) return;
    // Server channel messages are ignored for now; only DMs to the bot are handled.
    if (message.inGuild()) return;
    await handleDirectMessage(message);
  },
};
