import { REST, Routes } from 'discord.js';
import { ConfigError, loadEnv } from './config.js';
import { logger } from './lib/logger.js';
import { loadCommands } from './loaders/commands.js';

// Registers all slash commands globally (required for them to work in DMs). Run this only when
// a command's definition (name, description, options) changes, not on every start: Discord
// limits how many commands can be created per day.
try {
  const env = loadEnv();
  logger.level = env.logLevel;

  const commands = await loadCommands();
  const body = commands.map((command) => command.data.toJSON());

  logger.info({ commands: [...commands.keys()] }, 'Deploying global application commands');
  await new REST().setToken(env.token).put(Routes.applicationCommands(env.clientId), { body });
  logger.info({ count: body.length }, 'Deployed global application commands');
} catch (error) {
  if (error instanceof ConfigError) {
    logger.fatal(error.message);
  } else {
    logger.fatal({ err: error }, 'Failed to deploy commands');
  }
  process.exitCode = 1;
}
