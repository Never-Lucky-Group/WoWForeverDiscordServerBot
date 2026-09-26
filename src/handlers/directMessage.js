import { logger } from '../lib/logger.js';
import { findAllowlistedMemberships } from '../lib/membership.js';

export const DM_PLACEHOLDER_REPLY =
  "Hi! I received your message, but I don't have any direct message features yet.";

// Handles a DM to the bot. Only members of an allowlisted guild get a reply; others are ignored.
export async function handleDirectMessage(message) {
  const memberships = findAllowlistedMemberships(message.client, message.author.id);
  if (memberships.length === 0) {
    logger.debug(
      { userId: message.author.id },
      'Ignoring DM from a user who is not a member of any allowlisted guild',
    );
    return;
  }

  await message.reply(DM_PLACEHOLDER_REPLY);
}
