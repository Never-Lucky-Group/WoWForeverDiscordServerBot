import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { isTimeZone } from './lib/time.js';

// Thrown when environment variables or config.json are missing or invalid.
export class ConfigError extends Error {
  name = 'ConfigError';
}

const snowflake = z.string().regex(/^\d{17,20}$/, 'Expected a Discord ID (17-20 digits)');

// Treats `KEY=` (empty value in .env) the same as an unset variable so defaults apply.
const optionalEnv = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: snowflake,
  LOG_LEVEL: optionalEnv(
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ),
  BOT_CONFIG_PATH: optionalEnv(z.string().default('config.json')),
  LOOT_DB_PATH: optionalEnv(z.string().default('data/loot.sqlite')),
  RAIDS_DB_PATH: optionalEnv(z.string().default('data/raids.sqlite')),
  // JSON object of guild ID → that server's Raid-Helper API key (from Raid-Helper's /apikey). A
  // server with a key has the raid sign-up features, set up with /raidsetup.
  RAID_HELPER_API_KEYS: optionalEnv(
    z
      .string()
      .transform((text, context) => {
        try {
          return JSON.parse(text);
        } catch {
          context.addIssue({
            code: 'custom',
            message: 'Expected a JSON object such as {"<server ID>":"<API key>"}',
          });
          return z.NEVER;
        }
      })
      .pipe(z.record(snowflake, z.string().trim().min(1, 'API keys must not be empty')))
      .default({}),
  ),
});

// Returns { token, clientId, logLevel, configPath, lootDbPath, raidsDbPath, raidHelperApiKeys }.
// raidHelperApiKeys is a Map of guild ID → Raid-Helper API key.
export function loadEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new ConfigError(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }
  return {
    token: result.data.DISCORD_TOKEN,
    clientId: result.data.DISCORD_CLIENT_ID,
    logLevel: result.data.LOG_LEVEL,
    configPath: result.data.BOT_CONFIG_PATH,
    lootDbPath: result.data.LOOT_DB_PATH,
    raidsDbPath: result.data.RAIDS_DB_PATH,
    raidHelperApiKeys: new Map(Object.entries(result.data.RAID_HELPER_API_KEYS)),
  };
}

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a 24-hour time such as "15:00"');
const timeZone = z
  .string()
  .refine(isTimeZone, 'Expected an IANA time zone such as "Europe/London"');

// When the weekly raid lockout resets. "Last X weeks" in the loot commands counts back X resets.
const raidResetSchema = z.strictObject({
  weekday: z.enum(WEEKDAYS),
  time: timeOfDay,
  timeZone,
});

// Raid names offered when labelling Gargul imports. A Discord dropdown holds at most 25 options
// of up to 100 characters each.
const raidsSchema = z
  .array(z.string().trim().min(1).max(100))
  .min(1)
  .max(25)
  .refine((raids) => new Set(raids.map((raid) => raid.toLowerCase())).size === raids.length, {
    message: 'Raid names must be unique',
  });

const guildConfigSchema = z
  .strictObject({
    // Human-readable label for the config file only; the bot uses the live server name.
    name: z.string().optional(),
    id: snowflake,
    officerRoleId: snowflake,
    // Optional: role given to every human member who joins the guild.
    joinRoleId: snowflake.optional(),
    // Optional: the loot commands need this role as well as the Officer role. Without it, the
    // loot commands are disabled in this guild.
    lootRoleId: snowflake.optional(),
    // Optional: raid names for labelling Gargul imports. Required to import loot.
    raids: raidsSchema.optional(),
    // Optional: defaults to DEFAULT_RAID_RESET in loot/raidWeeks.js.
    raidReset: raidResetSchema.optional(),
    // No longer used: raid sign-ups are set up with /raidsetup. Accepted here only so an old
    // config gets the clear error below rather than "unrecognized key".
    raidHelper: z.unknown().optional(),
  })
  .refine((guild) => guild.raidHelper === undefined, {
    message:
      'raidHelper settings moved to /raidsetup in Discord; remove the raidHelper block from ' +
      'config.json and set raid sign-ups up again with /raidsetup',
    path: ['raidHelper'],
  })
  // A guild's @everyone role shares the guild's ID; using it would make every member an Officer.
  .refine((guild) => guild.officerRoleId !== guild.id, {
    message: 'officerRoleId is the @everyone role (same as the guild ID)',
    path: ['officerRoleId'],
  })
  .refine((guild) => guild.joinRoleId !== guild.id, {
    message: 'joinRoleId is the @everyone role (same as the guild ID)',
    path: ['joinRoleId'],
  })
  // Would make every member who joins an Officer.
  .refine((guild) => guild.joinRoleId !== guild.officerRoleId, {
    message: 'joinRoleId must not be the Officer role',
    path: ['joinRoleId'],
  })
  .refine((guild) => guild.lootRoleId !== guild.id, {
    message: 'lootRoleId is the @everyone role (same as the guild ID)',
    path: ['lootRoleId'],
  })
  // Every new member gets the join role, so the loot role check would be meaningless.
  .refine((guild) => guild.lootRoleId === undefined || guild.lootRoleId !== guild.joinRoleId, {
    message: 'lootRoleId must not be the join role',
    path: ['lootRoleId'],
  });

const botConfigFileSchema = z
  .strictObject({
    guilds: z
      .array(guildConfigSchema)
      .min(1, 'At least one guild must be allowlisted, otherwise the bot would leave every server'),
  })
  .refine(
    (config) => new Set(config.guilds.map((guild) => guild.id)).size === config.guilds.length,
    {
      message: 'Guild IDs must be unique',
      path: ['guilds'],
    },
  );

// Returns { guilds }: a Map of guild ID → { name?, id, officerRoleId, joinRoleId?, lootRoleId?,
// raids?, raidReset? } for every allowlisted guild.
export function parseBotConfig(raw) {
  const result = botConfigFileSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid bot config:\n${z.prettifyError(result.error)}`);
  }
  return { guilds: new Map(result.data.guilds.map((guild) => [guild.id, guild])) };
}

export async function loadBotConfig(path) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new ConfigError(
      `Could not read bot config at "${path}". Copy config.example.json to config.json and fill it in.`,
      { cause: error },
    );
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Bot config at "${path}" is not valid JSON.`, { cause: error });
  }

  return parseBotConfig(raw);
}
