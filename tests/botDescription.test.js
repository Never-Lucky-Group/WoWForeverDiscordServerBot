import { Routes } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import {
  DESCRIPTION_MAX_LENGTH,
  updateDescriptionOnStartup,
  withVersionLine,
} from '../src/lib/botDescription.js';
import { logger } from '../src/lib/logger.js';

describe('withVersionLine', () => {
  it('appends the version after a blank line', () => {
    expect(withVersionLine('WoW Forever guild bot.', '0.4.0')).toBe(
      'WoW Forever guild bot.\n\nVersion: 0.4.0',
    );
  });

  it('replaces the version line from an earlier start', () => {
    expect(withVersionLine('WoW Forever guild bot.\n\nVersion: 0.3.0', '0.4.0')).toBe(
      'WoW Forever guild bot.\n\nVersion: 0.4.0',
    );
  });

  it('replaces the version line in text with Windows line breaks', () => {
    expect(withVersionLine('First.\r\nSecond.\r\n\r\nVersion: 0.3.0', '0.4.0')).toBe(
      'First.\nSecond.\n\nVersion: 0.4.0',
    );
  });

  it('moves a version line edited into the middle of the text back to the end', () => {
    expect(withVersionLine('First.\nVersion: 0.3.0\nSecond.', '0.4.0')).toBe(
      'First.\nSecond.\n\nVersion: 0.4.0',
    );
  });

  it('keeps the rest of the text as written, including blank lines', () => {
    expect(withVersionLine('First.\n\nSecond.  \n\n', 'dev')).toBe(
      'First.\n\nSecond.\n\nVersion: dev',
    );
  });

  it.each([
    ['empty', ''],
    ['missing', null],
  ])('writes only the version line when the description is %s', (_label, description) => {
    expect(withVersionLine(description, '0.4.0')).toBe('Version: 0.4.0');
  });

  it('keeps lines that only mention a version', () => {
    expect(withVersionLine('Supports Gargul Version: 5', '0.4.0')).toBe(
      'Supports Gargul Version: 5\n\nVersion: 0.4.0',
    );
  });
});

function fakeRest(description, patch = () => Promise.resolve({})) {
  return {
    get: vi.fn(() => Promise.resolve({ description })),
    patch: vi.fn(patch),
  };
}

describe('updateDescriptionOnStartup', () => {
  it('writes the new description', async () => {
    const rest = fakeRest('WoW Forever guild bot.\n\nVersion: 0.3.0');
    await updateDescriptionOnStartup(rest, '0.4.0');
    expect(rest.get).toHaveBeenCalledExactlyOnceWith(Routes.currentApplication());
    expect(rest.patch).toHaveBeenCalledExactlyOnceWith(Routes.currentApplication(), {
      body: { description: 'WoW Forever guild bot.\n\nVersion: 0.4.0' },
    });
  });

  it('sends no edit when the description already shows the version', async () => {
    const rest = fakeRest('WoW Forever guild bot.\n\nVersion: 0.4.0');
    await updateDescriptionOnStartup(rest, '0.4.0');
    expect(rest.patch).not.toHaveBeenCalled();
  });

  it('warns and sends no edit when the version line would go over the limit', async () => {
    const rest = fakeRest('x'.repeat(DESCRIPTION_MAX_LENGTH - 10));
    const logWarn = vi.spyOn(logger, 'warn');

    await updateDescriptionOnStartup(rest, '0.4.0');

    expect(rest.patch).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledOnce();
  });

  it('writes a description of exactly the limit', async () => {
    const versionLine = '\n\nVersion: 0.4.0';
    const rest = fakeRest('x'.repeat(DESCRIPTION_MAX_LENGTH - versionLine.length));
    await updateDescriptionOnStartup(rest, '0.4.0');
    expect(rest.patch).toHaveBeenCalledOnce();
  });

  it.each([
    ['reading', (rest) => rest.get.mockRejectedValueOnce(new Error('Discord unavailable'))],
    ['writing', (rest) => rest.patch.mockRejectedValueOnce(new Error('Discord unavailable'))],
  ])('logs a failure while %s instead of throwing', async (_label, fail) => {
    const rest = fakeRest('WoW Forever guild bot.');
    fail(rest);
    const logError = vi.spyOn(logger, 'error');

    await expect(updateDescriptionOnStartup(rest, '0.4.0')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledOnce();
  });
});
