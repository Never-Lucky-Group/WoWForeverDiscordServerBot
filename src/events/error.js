import { Events } from 'discord.js';
import { logger } from '../lib/logger.js';

// Without an 'error' listener, Node's EventEmitter would crash the process on client errors.
export default {
  name: Events.Error,
  execute(error) {
    logger.error({ err: error }, 'Discord client error');
  },
};
