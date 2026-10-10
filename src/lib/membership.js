// A membership is { guild, member, guildConfig } for one allowlisted guild the user is in.

// Finds every allowlisted guild the user is currently a member of. Reads the member cache,
// which is filled at startup and kept current by the GuildMembers intent.
export function findAllowlistedMemberships(client, userId) {
  const memberships = [];
  for (const guildConfig of client.botConfig.guilds.values()) {
    const guild = client.guilds.cache.get(guildConfig.id);
    const member = guild?.members.cache.get(userId);
    if (guild && member) memberships.push({ guild, member, guildConfig });
  }
  return memberships;
}

export function isOfficer(member, guildConfig) {
  return member.roles.cache.has(guildConfig.officerRoleId);
}

// The loot commands need this role in addition to the Officer role. False when the guild has no
// loot role configured.
export function hasLootRole(member, guildConfig) {
  return Boolean(guildConfig.lootRoleId) && member.roles.cache.has(guildConfig.lootRoleId);
}
