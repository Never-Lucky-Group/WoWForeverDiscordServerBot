import { pino } from 'pino';

// Shared application logger. Emits JSON lines; `npm run dev` pipes them through pino-pretty.
// The level is set from LOG_LEVEL once the environment has been validated.
export const logger = pino({ level: 'info' });
