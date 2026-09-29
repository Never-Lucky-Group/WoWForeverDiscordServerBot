import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadBotConfig, loadEnv, parseBotConfig } from '../src/config.js';
import { GUILD_A, GUILD_B } from './helpers/fakes.js';

const validEnv = { DISCORD_TOKEN: 'token', DISCORD_CLIENT_ID: '123456789012345678' };

describe('loadEnv', () => {
  it('parses required values and applies defaults', () => {
    expect(loadEnv(validEnv)).toEqual({
      token: 'token',
      clientId: '123456789012345678',
      logLevel: 'info',
      configPath: 'config.json',
    });
  });

  it('treats empty optional values as unset', () => {
    const env = loadEnv({ ...validEnv, LOG_LEVEL: '', BOT_CONFIG_PATH: '' });
    expect(env.logLevel).toBe('info');
    expect(env.configPath).toBe('config.json');
  });

  it('accepts overrides', () => {
    const env = loadEnv({ ...validEnv, LOG_LEVEL: 'debug', BOT_CONFIG_PATH: '/etc/bot.json' });
    expect(env.logLevel).toBe('debug');
    expect(env.configPath).toBe('/etc/bot.json');
  });

  it.each([
    ['missing token', { DISCORD_CLIENT_ID: validEnv.DISCORD_CLIENT_ID }],
    ['empty token', { ...validEnv, DISCORD_TOKEN: '' }],
    ['non-numeric client ID', { ...validEnv, DISCORD_CLIENT_ID: 'abc' }],
    ['unknown log level', { ...validEnv, LOG_LEVEL: 'verbose' }],
  ])('rejects %s', (_label, source) => {
    expect(() => loadEnv(source)).toThrow(ConfigError);
  });
});

describe('parseBotConfig', () => {
  it('returns the allowlist keyed by guild ID', () => {
    const config = parseBotConfig({ guilds: [GUILD_A, GUILD_B] });
    expect([...config.guilds.keys()]).toEqual([GUILD_A.id, GUILD_B.id]);
    expect(config.guilds.get(GUILD_A.id)).toEqual(GUILD_A);
  });

  it('allows the name to be omitted', () => {
    const config = parseBotConfig({
      guilds: [{ id: GUILD_A.id, officerRoleId: GUILD_A.officerRoleId }],
    });
    expect(config.guilds.get(GUILD_A.id)?.name).toBeUndefined();
  });

  it('rejects an empty allowlist', () => {
    expect(() => parseBotConfig({ guilds: [] })).toThrow(/At least one guild/);
  });

  it('rejects duplicate guild IDs', () => {
    expect(() => parseBotConfig({ guilds: [GUILD_A, GUILD_A] })).toThrow(/unique/);
  });

  it('rejects invalid IDs', () => {
    expect(() => parseBotConfig({ guilds: [{ ...GUILD_A, officerRoleId: 'Officer' }] })).toThrow(
      ConfigError,
    );
  });

  it('rejects the @everyone role as the Officer role', () => {
    expect(() => parseBotConfig({ guilds: [{ ...GUILD_A, officerRoleId: GUILD_A.id }] })).toThrow(
      /@everyone/,
    );
  });

  it('accepts an optional join role', () => {
    const joinRoleId = '400000000000000001';
    const config = parseBotConfig({ guilds: [{ ...GUILD_A, joinRoleId }, GUILD_B] });
    expect(config.guilds.get(GUILD_A.id)?.joinRoleId).toBe(joinRoleId);
    expect(config.guilds.get(GUILD_B.id)?.joinRoleId).toBeUndefined();
  });

  it('rejects the @everyone role as the join role', () => {
    expect(() => parseBotConfig({ guilds: [{ ...GUILD_A, joinRoleId: GUILD_A.id }] })).toThrow(
      /joinRoleId is the @everyone role/,
    );
  });

  it('rejects the Officer role as the join role', () => {
    expect(() =>
      parseBotConfig({ guilds: [{ ...GUILD_A, joinRoleId: GUILD_A.officerRoleId }] }),
    ).toThrow(/must not be the Officer role/);
  });

  it('rejects unknown keys so typos are caught', () => {
    expect(() =>
      parseBotConfig({ guilds: [{ id: GUILD_A.id, officerRoleID: GUILD_A.officerRoleId }] }),
    ).toThrow(ConfigError);
  });
});

describe('loadBotConfig', () => {
  async function writeTempConfig(contents) {
    const dir = await mkdtemp(path.join(tmpdir(), 'bot-config-'));
    const file = path.join(dir, 'config.json');
    await writeFile(file, contents);
    return file;
  }

  it('reads and validates a config file', async () => {
    const file = await writeTempConfig(JSON.stringify({ guilds: [GUILD_A] }));
    const config = await loadBotConfig(file);
    expect(config.guilds.has(GUILD_A.id)).toBe(true);
  });

  it('explains how to create a missing config file', async () => {
    await expect(loadBotConfig('/nonexistent/config.json')).rejects.toThrow(/config.example.json/);
  });

  it('rejects invalid JSON', async () => {
    const file = await writeTempConfig('{ not json');
    await expect(loadBotConfig(file)).rejects.toThrow(/not valid JSON/);
  });
});
