import { MessageType } from 'discord.js';
import { logger } from '../lib/logger.js';
import { isAllowlisted } from './guildAllowlist.js';

// Temporary feature: the phrase and exempt role are hardcoded on purpose, so it can be removed
// without a config change.

// Any whitespace or punctuation between two letters, e.g. "s a d b o i" or "s.a.d-b_o_i".
const SEPARATOR = String.raw`[\s\p{P}]*`;
// "sadboi" or "sadbois" in any case, with separators between the letters of "sadboi". It must not
// touch another letter or digit on either side, so "sad boiler" and "his ad boils" are left alone.
// The plural "s" must follow directly, so the "'s" of "sad boi's" is kept.
const REDACTED_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${[...'sadboi'].join(SEPARATOR)}s?(?![\p{L}\p{N}])`,
  'giu',
);
export const REDACTED_TEXT = '[REDACTED]';
// Members with a role of this name are never redacted.
export const EXEMPT_ROLE_NAME = 'GM';

const MAX_MESSAGE_LENGTH = 2000;
// System messages (pins, joins, thread creation, ...) are never reposted.
const REDACTABLE_TYPES = new Set([MessageType.Default, MessageType.Reply]);
// IDs of messages being reposted, so an edit made meanwhile cannot repost the same message twice.
const inProgress = new Set();

// Returns the content with every match replaced by REDACTED_TEXT.
export function redact(content) {
  return content.replace(REDACTED_PATTERN, REDACTED_TEXT);
}

// The repost credits the author with a mention, wraps their text in quotation marks and fits
// Discord's message length limit. Long text is cut short so the closing quotation mark is kept.
export function buildRepost(authorId, redactedContent) {
  const prefix = `<@${authorId}>: "`;
  const suffix = '"';
  const room = MAX_MESSAGE_LENGTH - prefix.length - suffix.length;

  let text = redactedContent;
  if (text.length > room) {
    text = text.slice(0, room - 1);
    // Do not cut an emoji or other surrogate pair in half.
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    text = `${text}…`;
  }
  return `${prefix}${text}${suffix}`;
}

// Reposts a server message in the same channel with the phrase redacted, then deletes the original.
// Used for new and edited messages. Skips members with the exempt role.
// Never throws: failures are logged.
export async function redactMessage(message) {
  if (!REDACTABLE_TYPES.has(message.type)) return;

  const redacted = redact(message.content);
  if (redacted === message.content) return;

  const { guild } = message;
  if (!isAllowlisted(guild)) return;

  // Edited messages may come without member data; the member cache is filled at startup.
  const member = message.member ?? guild.members.cache.get(message.author.id);
  if (member?.roles.cache.some((role) => role.name === EXEMPT_ROLE_NAME)) return;

  const logInfo = {
    guildId: guild.id,
    channelId: message.channelId,
    messageId: message.id,
    userId: message.author.id,
  };

  // Checked before reposting, so a message the bot cannot delete is not duplicated.
  if (!message.deletable) {
    logger.warn(
      logInfo,
      'Cannot delete a message with a redacted phrase; the bot needs Manage Messages in this channel',
    );
    return;
  }

  if (inProgress.has(message.id)) return;
  inProgress.add(message.id);
  try {
    await repostAndDelete(message, redacted, logInfo);
  } finally {
    inProgress.delete(message.id);
  }
}

async function repostAndDelete(message, redacted, logInfo) {
  try {
    await message.channel.send({
      content: buildRepost(message.author.id, redacted),
      // Never ping anyone: not the author, nor @everyone, roles or users written in the original.
      allowedMentions: { parse: [], repliedUser: false },
      ...(message.type === MessageType.Reply &&
        message.reference?.messageId && {
          reply: { messageReference: message.reference.messageId, failIfNotExists: false },
        }),
    });
  } catch (error) {
    logger.error(
      { ...logInfo, err: error },
      'Failed to repost redacted message; kept the original',
    );
    return;
  }

  try {
    await message.delete();
    logger.info(logInfo, 'Redacted a message');
  } catch (error) {
    logger.error(
      { ...logInfo, err: error },
      'Reposted a redacted message but failed to delete the original',
    );
  }
}
