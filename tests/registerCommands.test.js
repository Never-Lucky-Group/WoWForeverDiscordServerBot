import { Collection, Routes } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import ping from '../src/commands/utility/ping.js';
import { logger } from '../src/lib/logger.js';
import { registerCommands, registerCommandsOnStartup } from '../src/lib/registerCommands.js';

const CLIENT_ID = '123456789012345678';

function fakeRest(put = () => Promise.resolve([])) {
  return { put: vi.fn(put) };
}

describe('registerCommands', () => {
  it('replaces the global command list with every loaded command', async () => {
    const rest = fakeRest();
    await registerCommands(rest, CLIENT_ID, new Collection([['ping', ping]]));
    expect(rest.put).toHaveBeenCalledExactlyOnceWith(Routes.applicationCommands(CLIENT_ID), {
      body: [ping.data.toJSON()],
    });
  });

  it('sends an empty list when there are no commands, removing them from Discord', async () => {
    const rest = fakeRest();
    await registerCommands(rest, CLIENT_ID, new Collection());
    expect(rest.put).toHaveBeenCalledWith(Routes.applicationCommands(CLIENT_ID), { body: [] });
  });

  it('throws when Discord rejects the request', async () => {
    const rest = fakeRest(() => Promise.reject(new Error('Discord unavailable')));
    await expect(
      registerCommands(rest, CLIENT_ID, new Collection([['ping', ping]])),
    ).rejects.toThrow('Discord unavailable');
  });
});

describe('registerCommandsOnStartup', () => {
  it('registers the commands', async () => {
    const rest = fakeRest();
    await registerCommandsOnStartup(rest, CLIENT_ID, new Collection([['ping', ping]]));
    expect(rest.put).toHaveBeenCalledOnce();
  });

  it('logs a failure instead of throwing', async () => {
    const error = new Error('Discord unavailable');
    const rest = fakeRest(() => Promise.reject(error));
    const logError = vi.spyOn(logger, 'error');

    await expect(
      registerCommandsOnStartup(rest, CLIENT_ID, new Collection([['ping', ping]])),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith({ err: error }, expect.any(String));
  });
});
