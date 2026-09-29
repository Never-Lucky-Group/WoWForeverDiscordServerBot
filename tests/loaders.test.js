import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createOfficerCommand, isCommand } from '../src/lib/command.js';
import { logger } from '../src/lib/logger.js';
import { loadCommands } from '../src/loaders/commands.js';
import { createListener, isBotEvent, loadEvents } from '../src/loaders/events.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');

describe('isCommand', () => {
  const data = createOfficerCommand('valid', 'A valid command');
  const execute = () => Promise.resolve();

  it('accepts a command with data and execute', () => {
    expect(isCommand({ data, execute })).toBe(true);
  });

  it.each([
    ['missing execute', { data }],
    ['non-function execute', { data, execute: 'run' }],
    ['missing data', { execute }],
    ['data without a name', { data: { toJSON: () => ({}) }, execute }],
    ['data without toJSON', { data: { name: 'valid' }, execute }],
    ['null', null],
    ['a string', 'command'],
  ])('rejects %s', (_label, value) => {
    expect(isCommand(value)).toBe(false);
  });
});

describe('isBotEvent', () => {
  it('accepts an event with a name and execute', () => {
    expect(isBotEvent({ name: 'messageCreate', execute: () => {} })).toBe(true);
  });

  it.each([
    ['missing name', { execute: () => {} }],
    ['missing execute', { name: 'messageCreate' }],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(isBotEvent(value)).toBe(false);
  });
});

describe('loadCommands', () => {
  it('loads the commands in src/commands', async () => {
    const commands = await loadCommands();
    expect([...commands.keys()]).toContain('ping');
  });

  it('rejects a module that is not a valid command', async () => {
    await expect(loadCommands(path.join(fixtures, 'invalid-commands'))).rejects.toThrow(
      /must default-export a command/,
    );
  });

  it('rejects duplicate command names', async () => {
    await expect(loadCommands(path.join(fixtures, 'duplicate-commands'))).rejects.toThrow(
      /Duplicate command name "duplicate"/,
    );
  });
});

describe('loadEvents', () => {
  it('subscribes every event in src/events, using once() where requested', async () => {
    const client = { on: vi.fn(), once: vi.fn() };
    const count = await loadEvents(client);

    const onEvents = client.on.mock.calls.map(([name]) => name);
    const onceEvents = client.once.mock.calls.map(([name]) => name);
    expect(count).toBe(onEvents.length + onceEvents.length);
    expect(onceEvents).toEqual(['clientReady']);
    expect(onEvents.sort()).toEqual([
      'error',
      'guildCreate',
      'guildMemberAdd',
      'interactionCreate',
      'messageCreate',
    ]);
  });
});

describe('createListener', () => {
  async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('passes the event arguments to execute', async () => {
    const execute = vi.fn();
    createListener({ name: 'error', execute })('a', 'b');
    await flush();
    expect(execute).toHaveBeenCalledWith('a', 'b');
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('async failure'))],
    [
      'throws',
      () => {
        throw new Error('sync failure');
      },
    ],
  ])('logs instead of crashing when execute %s', async (_label, execute) => {
    const error = vi.spyOn(logger, 'error');
    createListener({ name: 'messageCreate', execute })();
    await flush();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'messageCreate' }),
      'Event handler failed',
    );
  });
});
