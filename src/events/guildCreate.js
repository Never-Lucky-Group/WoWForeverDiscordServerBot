import { Events } from 'discord.js';
import { prepareGuild } from '../handlers/guildAllowlist.js';
import { logger } from '../lib/logger.js';

export default {
  name: Events.GuildCreate,
  async execute(guild) {
    logger.info({ guildId: guild.id, guildName: guild.name }, 'Bot was added to a guild');
    await prepareGuild(guild);
  },
};
