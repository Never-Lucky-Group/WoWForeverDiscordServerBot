import { createClient } from './client.js';
import { ConfigError, loadBotConfig, loadEnv } from './config.js';
import { logger } from './lib/logger.js';
import { registerCommandsOnStartup } from './lib/registerCommands.js';
import { loadCommands } from './loaders/commands.js';
import { loadEvents } from './loaders/events.js';
import { openLootDatabase } from './loot/database.js';
import { LootStore } from './loot/store.js';

async function main() {
  const env = loadEnv();
  logger.level = env.logLevel;

  const client = createClient();
  // Attached to the client so event handlers can reach them via interaction.client, etc.
  client.botConfig = await loadBotConfig(env.configPath);
  client.commands = await loadCommands();
  client.lootStore = openLootStore(env.lootDbPath);
  const eventCount = await loadEvents(client);
  logger.info(
    {
      allowlistedGuilds: client.botConfig.guilds.size,
      commands: client.commands.size,
      events: eventCount,
    },
    'Starting bot',
  );

  registerShutdownHandlers(client);
  await client.login(env.token);

  // Runs in the background so registration never delays the bot coming online; client.rest has
  // the token once login() resolves.
  void registerCommandsOnStartup(client.rest, env.clientId, client.commands);
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

function registerShutdownHandlers(client) {
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    try {
      client.lootStore?.db.close();
    } catch (error) {
      logger.error({ err: error }, 'Failed to close the loot database');
    }
    void client.destroy().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
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
