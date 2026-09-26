import { describe, expect, it, vi } from 'vitest';
import messageCreate from '../src/events/messageCreate.js';
import { DM_PLACEHOLDER_REPLY } from '../src/handlers/directMessage.js';
import {
  GUILD_A,
  USER_ID,
  fakeClient,
  fakeGuild,
  fakeMember,
  makeBotConfig,
} from './helpers/fakes.js';

function fakeMessage({ authorId = USER_ID, bot = false, inGuild = false } = {}) {
  const client = fakeClient({
    botConfig: makeBotConfig(GUILD_A),
    guilds: [fakeGuild(GUILD_A, [fakeMember(USER_ID)])],
  });
  return {
    client,
    author: { id: authorId, bot },
    inGuild: () => inGuild,
    reply: vi.fn(() => Promise.resolve()),
  };
}

describe('messageCreate', () => {
  it('replies with the placeholder to a DM from an allowlisted guild member', async () => {
    const message = fakeMessage();
    await messageCreate.execute(message);
    expect(message.reply).toHaveBeenCalledWith(DM_PLACEHOLDER_REPLY);
  });

  it('ignores a DM from a user who is not in any allowlisted guild', async () => {
    const message = fakeMessage({ authorId: '399999999999999999' });
    await messageCreate.execute(message);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('ignores messages in server channels', async () => {
    const message = fakeMessage({ inGuild: true });
    await messageCreate.execute(message);
    expect(message.reply).not.toHaveBeenCalled();
  });

  it('ignores messages from bots', async () => {
    const message = fakeMessage({ bot: true });
    await messageCreate.execute(message);
    expect(message.reply).not.toHaveBeenCalled();
  });
});
