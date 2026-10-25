import { createClient } from './client.js';
import { ConfigError, loadBotConfig, loadEnv } from './config.js';
import { updateDescriptionOnStartup } from './lib/botDescription.js';
import { logger } from './lib/logger.js';
import { registerCommandsOnStartup } from './lib/registerCommands.js';
import { loadCommands } from './loaders/commands.js';
import { loadEvents } from './loaders/events.js';
import { openLootDatabase } from './loot/database.js';
import { LootStore } from './loot/store.js';
import { RaidHelperClient } from './raids/apiClient.js';
import { openRaidsDatabase } from './raids/database.js';
import { RaidScheduler } from './raids/scheduler.js';
import { RaidStore } from './raids/store.js';

async function main() {
  const env = loadEnv();
  logger.level = env.logLevel;

  const client = createClient();
  // Attached to the client so event handlers can reach them via interaction.client, etc.
  client.botConfig = await loadBotConfig(env.configPath);
  client.commands = await loadCommands();
  client.lootStore = openLootStore(env.lootDbPath);
  client.raids = setUpRaids(client, env);
  const eventCount = await loadEvents(client);
  logger.info(
    {
      allowlistedGuilds: client.botConfig.guilds.size,
      commands: client.commands.size,
      events: eventCount,
      version: env.version,
    },
    'Starting bot',
  );

  registerShutdownHandlers(client);
  await client.login(env.token);

  // Runs in the background so registration never delays the bot coming online; client.rest has
  // the token once login() resolves.
  void registerCommandsOnStartup(client.rest, env.clientId, client.commands);
  void updateDescriptionOnStartup(client.rest, env.version);
}

// A loot database that cannot be opened (e.g. the data volume is missing) disables only the loot
// commands, so the rest of the bot keeps running. Returns null in that case.
function openLootStore(dbPath) {
  try {
    const store = new LootStore(openLootDatabase(dbPath));
    logger.info({ dbPath }, 'Opened the loot database');
    return store;
  } catch (error) {
    logger.error({ err: error, dbPath }, 'Could not open the loot database; loot commands are off');
    return null;
  }
}

// Opens the raids database and sets up what /raid, /absence and the background loop need; ready.js
// starts the loop. As with loot, a database that cannot be opened disables only these features:
// store and scheduler are then null.
function setUpRaids(client, env) {
  // A key turns the raid features on for its server; Officers set them up with /raidsetup.
  const apiKeys = env.raidHelperApiKeys;
  for (const guildId of apiKeys.keys()) {
    if (!client.botConfig.guilds.has(guildId)) {
      logger.warn(
        { guildId },
        'RAID_HELPER_API_KEYS has a key for a server that is not in the allowlist; it is unused',
      );
    }
  }

  const api = new RaidHelperClient();
  let store = null;
  try {
    store = new RaidStore(openRaidsDatabase(env.raidsDbPath));
    logger.info({ dbPath: env.raidsDbPath }, 'Opened the raids database');
  } catch (error) {
    logger.error(
      { err: error, dbPath: env.raidsDbPath },
      'Could not open the raids database; the raid commands and Raid-Helper reminders are off',
    );
  }
  const scheduler = store ? new RaidScheduler({ client, store, api, apiKeys }) : null;
  return { store, api, apiKeys, scheduler };
}

// How long shutdown waits for a run of the Raid-Helper loop to finish. Docker kills the container
// 10 seconds after asking it to stop.
const SHUTDOWN_WAIT_MS = 5_000;

function registerShutdownHandlers(client) {
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    void stopBot(client).finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// Lets a run of the Raid-Helper loop finish while commands still work, then disconnects from
// Discord so no new commands arrive, and only then closes the databases.
async function stopBot(client) {
  try {
    const finished = await client.raids?.scheduler?.stop(SHUTDOWN_WAIT_MS);
    if (finished === false) {
      logger.warn('Stopping during a Raid-Helper run; it is cut short');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to stop the Raid-Helper loop');
  }
  try {
    await client.destroy();
  } catch (error) {
    logger.error({ err: error }, 'Failed to disconnect from Discord');
  }
  closeDatabase(client.lootStore, 'loot');
  closeDatabase(client.raids?.store, 'raids');
}

function closeDatabase(store, label) {
  try {
    store?.db.close();
  } catch (error) {
    logger.error({ err: error }, `Failed to close the ${label} database`);
  }
}

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled promise rejection');
});

try {
  await main();
} catch (error) {
  if (error instanceof ConfigError) {
    logger.fatal(error.message);
  } else {
    logger.fatal({ err: error }, 'Failed to start the bot');
  }
  process.exit(1);
}
