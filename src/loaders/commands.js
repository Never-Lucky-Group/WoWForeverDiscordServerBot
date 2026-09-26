import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Collection } from 'discord.js';
import { isCommand } from '../lib/command.js';
import { findModuleFiles } from './files.js';

const COMMANDS_DIR = path.join(import.meta.dirname, '..', 'commands');

// Imports every command module under src/commands/<category>/ into a Collection keyed by command
// name. Throws on invalid or duplicate commands.
export async function loadCommands(directory = COMMANDS_DIR) {
  const commands = new Collection();

  for (const filePath of await findModuleFiles(directory)) {
    const { default: command } = await import(pathToFileURL(filePath).href);
    if (!isCommand(command)) {
      throw new Error(`${filePath} must default-export a command with "data" and "execute"`);
    }
    if (commands.has(command.data.name)) {
      throw new Error(`Duplicate command name "${command.data.name}" in ${filePath}`);
    }
    commands.set(command.data.name, command);
  }

  return commands;
}
