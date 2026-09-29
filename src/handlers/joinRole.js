import { logger } from '../lib/logger.js';

// Gives a newly joined member their guild's configured join role. Skips bots, guilds that are not
// allowlisted, and guilds without a joinRoleId.
// Never throws: failures are logged.
export async function assignJoinRole(member) {
  if (member.user.bot) return;

  const { guild } = member;
  const joinRoleId = guild.client.botConfig.guilds.get(guild.id)?.joinRoleId;
  if (!joinRoleId) return;

  const logInfo = { guildId: guild.id, userId: member.id, roleId: joinRoleId };
  try {
    await member.roles.add(joinRoleId, 'Auto-assigned on join');
    logger.info(logInfo, 'Gave join role to new member');
  } catch (error) {
    logger.error({ ...logInfo, err: error }, 'Failed to give join role to new member');
  }
}

// Warns when an allowlisted guild's join role is missing or the bot cannot assign it, so the
// problem shows up in the logs before anyone joins.
export function checkJoinRole(guild, guildConfig) {
  const { joinRoleId } = guildConfig;
  if (!joinRoleId) return;

  const logInfo = { guildId: guild.id, guildName: guild.name, roleId: joinRoleId };
  const role = guild.roles.cache.get(joinRoleId);
  if (!role) {
    logger.warn(logInfo, 'Join role does not exist in this guild; new members will not get it');
  } else if (!role.editable) {
    logger.warn(
      logInfo,
      'Bot cannot assign the join role; it needs Manage Roles, a role above the join role, and ' +
        'the join role must not be managed by an integration',
    );
  }
}
