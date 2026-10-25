import { isOfficer } from '../lib/membership.js';
import { rosterRoleIds } from './schedule.js';
import { loadSetup } from './setup.js';

export const NOT_CONFIGURED_MESSAGE =
  'Raid sign-ups are not set up for this server: add its Raid-Helper API key to ' +
  'RAID_HELPER_API_KEYS in .env.';
export const STORE_UNAVAILABLE_MESSAGE =
  'The raids database is unavailable, so the raid commands are disabled. Check the bot logs.';

// Whether the raid features are on in a server: it has a Raid-Helper API key and the raids
// database is open.
export function raidsEnabled(client, guildId) {
  const raids = client?.raids;
  return Boolean(raids?.store && raids.apiKeys.has(guildId));
}

// The server's raid setup now, or null when the raid features are off there.
export function currentSetup(client, guildConfig) {
  if (!raidsEnabled(client, guildConfig.id)) return null;
  return loadSetup(client.raids.store, guildConfig, Math.floor(Date.now() / 1000));
}

// Whether `member` has any of the server's roster roles.
export function hasRaiderRole(member, setup) {
  return [...rosterRoleIds(setup)].some((roleId) => member.roles.cache.has(roleId));
}

// Officers, in servers with the raid features on. For /raid and /raidsetup.
export function canUseRaidCommands(member, guildConfig) {
  return raidsEnabled(member.client, guildConfig.id) && isOfficer(member, guildConfig);
}

// Whether `member` may manage absences: raiders and Officers, in servers with the raid features
// on.
export function canUseAbsences(member, guildConfig) {
  if (!raidsEnabled(member.client, guildConfig.id)) return false;
  if (isOfficer(member, guildConfig)) return true;
  return hasRaiderRole(member, currentSetup(member.client, guildConfig));
}

// Returns { context } with what the raid handlers need added to the command context, or
// { error } with a message explaining why the command cannot run:
//   { guild, member, guildConfig, setup, store, api, scheduler, apiKey, timeZone }
// setup is from loadSetup(); timeZone is setup.timeZone.
export function raidsContext(interaction, context) {
  const raids = interaction.client.raids;
  const apiKey = raids?.apiKeys.get(context.guild.id);
  if (!apiKey) return { error: NOT_CONFIGURED_MESSAGE };
  if (!raids.store) return { error: STORE_UNAVAILABLE_MESSAGE };
  const setup = loadSetup(raids.store, context.guildConfig, Math.floor(Date.now() / 1000));
  return {
    context: {
      ...context,
      setup,
      store: raids.store,
      api: raids.api,
      scheduler: raids.scheduler,
      apiKey,
      timeZone: setup.timeZone,
    },
  };
}
