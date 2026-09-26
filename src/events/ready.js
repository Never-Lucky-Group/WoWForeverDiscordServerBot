import { Events } from 'discord.js';
import { prepareGuild } from '../handlers/guildAllowlist.js';
import { logger } from '../lib/logger.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(
      { user: client.user.tag, guildCount: client.guilds.cache.size },
      'Logged in to Discord',
    );

    // Catches servers the bot was added to while it was offline.
    await Promise.all(client.guilds.cache.map((guild) => prepareGuild(guild)));

    for (const guildConfig of client.botConfig.guilds.values()) {
      if (!client.guilds.cache.has(guildConfig.id)) {
        logger.warn(
          { guildId: guildConfig.id, guildName: guildConfig.name },
          'Allowlisted guild has not added the bot yet',
        );
      }
    }
  },
};
