import { logger } from '../lib/logger.js';

export function isAllowlisted(guild) {
  return guild.client.botConfig.guilds.has(guild.id);
}

// Called for every guild at startup and whenever the bot joins one. Leaves guilds that are not
// allowlisted; for allowlisted guilds, loads the full member list into the cache.
// Never throws: failures are logged so one guild cannot block the others.
export async function prepareGuild(guild) {
  const guildInfo = { guildId: guild.id, guildName: guild.name };

  if (!isAllowlisted(guild)) {
    logger.warn(guildInfo, 'Bot is in a guild that is not on the allowlist; leaving it');
    try {
      await guild.leave();
    } catch (error) {
      logger.error({ ...guildInfo, err: error }, 'Failed to leave non-allowlisted guild');
    }
    return;
  }

  try {
    const members = await guild.members.fetch();
    logger.info({ ...guildInfo, memberCount: members.size }, 'Cached guild members');
  } catch (error) {
    logger.error(
      { ...guildInfo, err: error },
      'Failed to cache guild members; DM membership checks for this guild may miss members',
    );
  }
}
