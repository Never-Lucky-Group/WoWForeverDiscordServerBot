import { Routes } from 'discord.js';
import { logger } from './logger.js';

// Replaces the application's global slash commands with `commands` (the Collection returned by
// loadCommands). Global registration is required for commands to work in DMs. Commands missing
// from the list are removed from Discord. Re-sending an unchanged list does not count toward
// Discord's daily limit of 200 command creates; only command names that are new to Discord do.
export async function registerCommands(rest, clientId, commands) {
  const body = commands.map((command) => command.data.toJSON());
  logger.info({ commands: [...commands.keys()] }, 'Registering global application commands');
  await rest.put(Routes.applicationCommands(clientId), { body });
  logger.info({ count: body.length }, 'Registered global application commands');
}

// Used at startup so Discord always lists the commands of the version that is running. Never
// throws: a failure is logged and Discord keeps its previous list until the next start.
export async function registerCommandsOnStartup(rest, clientId, commands) {
  try {
    await registerCommands(rest, clientId, commands);
  } catch (error) {
    logger.error(
      { err: error },
      'Failed to register slash commands; Discord keeps the previous list until the next start',
    );
  }
}
