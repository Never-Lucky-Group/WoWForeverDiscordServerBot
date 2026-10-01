import { Collection, MessageType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import messageCreate from '../src/events/messageCreate.js';
import messageUpdate from '../src/events/messageUpdate.js';
import {
  EXEMPT_ROLE_NAME,
  REDACTED_TEXT,
  buildRepost,
  redact,
  redactMessage,
} from '../src/handlers/redactedWords.js';
import { logger } from '../src/lib/logger.js';
import { GUILD_A, USER_ID, fakeClient, fakeGuild, makeBotConfig } from './helpers/fakes.js';

const CHANNEL_ID = '500000000000000001';
const MESSAGE_ID = '600000000000000001';
const REPLIED_MESSAGE_ID = '600000000000000002';
const GM_ROLE = { id: '400000000000000001', name: EXEMPT_ROLE_NAME };
const OTHER_ROLE = { id: '400000000000000002', name: 'Raider' };
const UNLISTED = { name: 'Random server', id: '100000000000000009', officerRoleId: GM_ROLE.id };

// A message in a server channel. GUILD_A is the only allowlisted guild.
function guildMessage({
  content = 'what a sad boi',
  type = MessageType.Default,
  roles = [],
  memberOnMessage = true,
  deletable = true,
  config = GUILD_A,
  reference,
  bot = false,
} = {}) {
  const member = { id: USER_ID, roles: { cache: new Collection(roles.map((r) => [r.id, r])) } };
  const guild = fakeGuild(config, [member]);
  const client = fakeClient({ botConfig: makeBotConfig(GUILD_A), guilds: [guild] });
  return {
    id: MESSAGE_ID,
    client,
    type,
    content,
    deletable,
    reference,
    partial: false,
    author: { id: USER_ID, bot },
    member: memberOnMessage ? member : null,
    guild,
    guildId: guild.id,
    channelId: CHANNEL_ID,
    inGuild: () => true,
    channel: { id: CHANNEL_ID, send: vi.fn(() => Promise.resolve()) },
    delete: vi.fn(() => Promise.resolve()),
  };
}

describe('redact', () => {
  it.each([
    ['sad boi', REDACTED_TEXT],
    ['Sad Boi', REDACTED_TEXT],
    ['SAD BOI', REDACTED_TEXT],
    ['sad   boi', REDACTED_TEXT],
    ['sad\nboi', REDACTED_TEXT],
    ['sadboi', REDACTED_TEXT],
    ['sad bois', REDACTED_TEXT],
    ['SadBois', REDACTED_TEXT],
    ['such a sad boi!', `such a ${REDACTED_TEXT}!`],
    ["the sad boi's gear", `the ${REDACTED_TEXT}'s gear`],
    ['sad boi and sadbois', `${REDACTED_TEXT} and ${REDACTED_TEXT}`],
    ['s   a  d   b   o  i', REDACTED_TEXT],
    ['S A D B O I S', `${REDACTED_TEXT} S`],
    ['s.a.d.b.o.i', REDACTED_TEXT],
    ['s-a-d b_o_i', REDACTED_TEXT],
    ['s.a.d.b.o.is', REDACTED_TEXT],
    ['s, a! d? b... o* i', REDACTED_TEXT],
    ['_sad boi_', `_${REDACTED_TEXT}_`],
    ['**sad** boi', `**${REDACTED_TEXT}`],
    ['(sad boi)', `(${REDACTED_TEXT})`],
  ])('redacts %j', (content, expected) => {
    expect(redact(content)).toBe(expected);
  });

  it.each([
    'sad boiler',
    'unsad boi',
    'sad boy',
    'so sad',
    'boi',
    'sadboiz',
    'sadboi2',
    'his ad boils down to price',
    'sad b oil',
    's a d b o y',
    '',
  ])('leaves %j unchanged', (content) => {
    expect(redact(content)).toBe(content);
  });
});

describe('buildRepost', () => {
  const prefix = `<@${USER_ID}>: "`;

  it('credits the author with a mention and quotes their text', () => {
    expect(buildRepost(USER_ID, 'hi')).toBe(`<@${USER_ID}>: "hi"`);
  });

  it('keeps a repost that is exactly at the limit', () => {
    const content = 'a'.repeat(2000 - prefix.length - 1);
    expect(buildRepost(USER_ID, content)).toBe(`${prefix}${content}"`);
  });

  it('truncates a repost over 2000 characters with an ellipsis, keeping the closing quote', () => {
    const repost = buildRepost(USER_ID, 'a'.repeat(2000));
    expect(repost).toHaveLength(2000);
    expect(repost.startsWith(prefix)).toBe(true);
    expect(repost.endsWith('a…"')).toBe(true);
  });

  it('does not cut an emoji in half when truncating', () => {
    // The emoji's first half would be the last character kept.
    const content = 'a'.repeat(2000 - prefix.length - 3) + '😢'.repeat(10);
    const repost = buildRepost(USER_ID, content);
    expect(repost.endsWith('a…"')).toBe(true);
    expect(repost.length).toBeLessThanOrEqual(2000);
  });
});

describe('redactMessage', () => {
  it('reposts the redacted message, then deletes the original', async () => {
    const message = guildMessage();
    await redactMessage(message);

    expect(message.channel.send).toHaveBeenCalledExactlyOnceWith({
      content: `<@${USER_ID}>: "what a ${REDACTED_TEXT}"`,
      allowedMentions: { parse: [], repliedUser: false },
    });
    expect(message.delete).toHaveBeenCalledOnce();
    expect(message.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      message.delete.mock.invocationCallOrder[0],
    );
  });

  it('never pings @everyone or roles written in the original', async () => {
    const message = guildMessage({ content: '@everyone <@&400000000000000002> sad boi' });
    await redactMessage(message);
    const [options] = message.channel.send.mock.calls[0];
    expect(options.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it('replies to the same message as the original reply', async () => {
    const message = guildMessage({
      type: MessageType.Reply,
      reference: { messageId: REPLIED_MESSAGE_ID },
    });
    await redactMessage(message);
    const [options] = message.channel.send.mock.calls[0];
    expect(options.reply).toEqual({
      messageReference: REPLIED_MESSAGE_ID,
      failIfNotExists: false,
    });
  });

  it('keeps Officers and other roles in scope', async () => {
    const message = guildMessage({
      roles: [OTHER_ROLE, { id: GUILD_A.officerRoleId, name: 'Officer' }],
    });
    await redactMessage(message);
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it('skips members with the GM role', async () => {
    const message = guildMessage({ roles: [OTHER_ROLE, GM_ROLE] });
    await redactMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
  });

  it('reads the GM role from the member cache when the message has no member', async () => {
    const message = guildMessage({ roles: [GM_ROLE], memberOnMessage: false });
    await redactMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('ignores messages without the phrase', async () => {
    const message = guildMessage({ content: 'what a happy boi' });
    await redactMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(message.delete).not.toHaveBeenCalled();
  });

  it('ignores system messages', async () => {
    const message = guildMessage({ type: MessageType.ThreadCreated, content: 'sad boi' });
    await redactMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('ignores guilds that are not allowlisted', async () => {
    const message = guildMessage({ config: UNLISTED });
    await redactMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('does not repost a message the bot cannot delete', async () => {
    const warn = vi.spyOn(logger, 'warn');
    const message = guildMessage({ deletable: false });
    await redactMessage(message);
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('keeps the original and logs when the repost fails', async () => {
    const error = vi.spyOn(logger, 'error');
    const message = guildMessage();
    message.channel.send.mockRejectedValueOnce(new Error('Missing Permissions'));
    await expect(redactMessage(message)).resolves.toBeUndefined();
    expect(message.delete).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it('reposts only once when an edit arrives while the message is being reposted', async () => {
    const message = guildMessage();
    let finishSend;
    message.channel.send.mockReturnValueOnce(new Promise((resolve) => (finishSend = resolve)));

    const first = redactMessage(message);
    await redactMessage(message);
    finishSend();
    await first;

    expect(message.channel.send).toHaveBeenCalledOnce();
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it('logs and does not throw when deleting the original fails', async () => {
    const error = vi.spyOn(logger, 'error');
    const message = guildMessage();
    message.delete.mockRejectedValueOnce(new Error('Unknown Message'));
    await expect(redactMessage(message)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
  });
});

describe('messageCreate in server channels', () => {
  it('redacts a new message', async () => {
    const message = guildMessage();
    await messageCreate.execute(message);
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it('ignores bots, including the bot’s own reposts', async () => {
    const message = guildMessage({ bot: true });
    await messageCreate.execute(message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});

describe('messageUpdate', () => {
  const cachedOld = (content) => ({ partial: false, content });
  const uncachedOld = { partial: true, content: null };

  it('redacts a message edited to include the phrase', async () => {
    const message = guildMessage();
    await messageUpdate.execute(cachedOld('what a boi'), message);
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it('ignores updates that do not change the text, such as embeds loading', async () => {
    const message = guildMessage();
    await messageUpdate.execute(cachedOld(message.content), message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('checks an edited message that was not cached', async () => {
    const message = guildMessage();
    await messageUpdate.execute(uncachedOld, message);
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it('fetches a partial edited message before checking it', async () => {
    const message = guildMessage();
    const partial = { ...message, partial: true, fetch: vi.fn(() => Promise.resolve(message)) };
    await messageUpdate.execute(uncachedOld, partial);
    expect(partial.fetch).toHaveBeenCalledOnce();
    expect(message.delete).toHaveBeenCalledOnce();
  });

  it('logs and stops when fetching a partial edited message fails', async () => {
    const error = vi.spyOn(logger, 'error');
    const message = guildMessage();
    const partial = {
      ...message,
      partial: true,
      fetch: vi.fn(() => Promise.reject(new Error('Unknown Message'))),
    };
    await expect(messageUpdate.execute(uncachedOld, partial)).resolves.toBeUndefined();
    expect(message.channel.send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it('ignores edits by bots', async () => {
    const message = guildMessage({ bot: true });
    await messageUpdate.execute(uncachedOld, message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });

  it('ignores edits in DMs', async () => {
    const message = { ...guildMessage(), inGuild: () => false };
    await messageUpdate.execute(uncachedOld, message);
    expect(message.channel.send).not.toHaveBeenCalled();
  });
});
