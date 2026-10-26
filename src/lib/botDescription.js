import { Routes } from 'discord.js';
import { logger } from './logger.js';

// Discord's limit for an application description, which is the bot's About Me.
export const DESCRIPTION_MAX_LENGTH = 400;

const VERSION_LINE = /^Version: .*$/;

// Returns `description` with the bot's version as its last line, after a blank line. A version line
// written by an earlier start is replaced; the rest of the text, written in the Developer Portal,
// is kept. Line breaks become \n.
export function withVersionLine(description, version) {
  const text = (description ?? '')
    .split(/\r?\n/)
    .filter((line) => !VERSION_LINE.test(line))
    .join('\n')
    .trimEnd();
  const versionLine = `Version: ${version}`;
  return text ? `${text}\n\n${versionLine}` : versionLine;
}

// Writes the running version into the bot's description, which is shared by every server. Sends
// the edit only when the text changes, so restarts cost one request. Never throws: a failure is
// logged and the description stays as it was.
export async function updateDescriptionOnStartup(rest, version) {
  try {
    const application = await rest.get(Routes.currentApplication());
    const description = withVersionLine(application.description, version);
    if (description === application.description) {
      logger.debug({ version }, 'Bot description already shows this version');
      return;
    }
    if (description.length > DESCRIPTION_MAX_LENGTH) {
      logger.warn(
        { version, length: description.length, maxLength: DESCRIPTION_MAX_LENGTH },
        'Bot description would be too long with the version line; shorten it in the Developer Portal',
      );
      return;
    }
    await rest.patch(Routes.currentApplication(), { body: { description } });
    logger.info({ version }, 'Updated the bot description with the running version');
  } catch (error) {
    logger.error({ err: error }, 'Failed to update the bot description; it stays as it was');
  }
}
