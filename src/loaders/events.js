import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { logger } from '../lib/logger.js';
import { findModuleFiles } from './files.js';

const EVENTS_DIR = path.join(import.meta.dirname, '..', 'events');

// Every module under src/events/ default-exports an event:
//
//   {
//     name,      // a discord.js Events value, e.g. Events.MessageCreate
//     once,      // optional: true to run only the first time the event fires
//     execute,   // (...eventArgs) => {}, may be async
//   }

export function isBotEvent(value) {
  return typeof value?.name === 'string' && typeof value.execute === 'function';
}

// Wraps an event's handler so errors (sync or async) are logged instead of becoming unhandled
// rejections.
export function createListener(event) {
  return (...args) => {
    void (async () => {
      try {
        await event.execute(...args);
      } catch (error) {
        logger.error({ err: error, event: event.name }, 'Event handler failed');
      }
    })();
  };
}

// Imports every event module under src/events/ and subscribes it to the client. Returns the count.
export async function loadEvents(client, directory = EVENTS_DIR) {
  const files = await findModuleFiles(directory);

  for (const filePath of files) {
    const { default: event } = await import(pathToFileURL(filePath).href);
    if (!isBotEvent(event)) {
      throw new Error(`${filePath} must default-export an event with "name" and "execute"`);
    }
    const listener = createListener(event);
    if (event.once) {
      client.once(event.name, listener);
    } else {
      client.on(event.name, listener);
    }
  }

  return files.length;
}
