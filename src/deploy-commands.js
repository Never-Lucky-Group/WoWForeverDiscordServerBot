import { REST } from 'discord.js';
import { ConfigError, loadEnv } from './config.js';
import { logger } from './lib/logger.js';
import { registerCommands } from './lib/registerCommands.js';
import { loadCommands } from './loaders/commands.js';

// Registers all slash commands globally without starting the bot. The bot already does this
// every time it starts, so this is only a manual fallback.
try {
  const env = loadEnv();
  logger.level = env.logLevel;

  const commands = await loadCommands();
  await registerCommands(new REST().setToken(env.token), env.clientId, commands);
} catch (error) {
  if (error instanceof ConfigError) {
    logger.fatal(error.message);
  } else {
    logger.fatal({ err: error }, 'Failed to deploy commands');
  }
  process.exitCode = 1;
}
