import { createClient } from './client.js';
import { ConfigError, loadBotConfig, loadEnv } from './config.js';
import { logger } from './lib/logger.js';
import { loadCommands } from './loaders/commands.js';
import { loadEvents } from './loaders/events.js';

async function main() {
  const env = loadEnv();
  logger.level = env.logLevel;

  const client = createClient();
  // Attached to the client so event handlers can reach them via interaction.client, etc.
  client.botConfig = await loadBotConfig(env.configPath);
  client.commands = await loadCommands();
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
}

function registerShutdownHandlers(client) {
  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
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
