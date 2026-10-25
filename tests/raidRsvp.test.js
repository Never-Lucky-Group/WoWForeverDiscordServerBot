import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import interactionCreate from '../src/events/interactionCreate.js';
import { RaidHelperError } from '../src/raids/apiClient.js';
import {
  RAID_HELPER_DOWN_MESSAGE,
  STALE_MESSAGE,
  UNAVAILABLE_MESSAGE,
  handleRsvpButton,
  parseRsvpCustomId,
  rsvpCustomId,
  rsvpMessage,
} from '../src/raids/rsvp.js';
import { GUILD_A, GUILD_B, USER_ID, makeBotConfig } from './helpers/fakes.js';
import {
  RAID_GUILD,
  fakeApi,
  raidEvent,
  raidGuild,
  raidMember,
  raidStore,
  raidsClient,
  seconds,
} from './helpers/raids.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const EVENT = raidEvent();

function setup({ answer = 'yes', events = [EVENT], member = raidMember(USER_ID, 'Amy') } = {}) {
  const guild = raidGuild(member ? [member] : []);
  const store = raidStore();
  const api = fakeApi(events);
  const interaction = {
    customId: rsvpCustomId(GUILD_A.id, EVENT.id, answer),
    user: { id: USER_ID },
    client: {
      botConfig: makeBotConfig(RAID_GUILD),
      guilds: { cache: new Collection([[guild.id, guild]]) },
      ...raidsClient({ store, api }),
    },
    isButton: () => true,
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    reply: vi.fn(() => Promise.resolve()),
    deferUpdate: vi.fn(() => Promise.resolve()),
    editReply: vi.fn(() => Promise.resolve()),
    followUp: vi.fn(() => Promise.resolve()),
  };
  return { interaction, store, api };
}

describe('RSVP custom IDs', () => {
  it('round-trips and rejects other IDs', () => {
    expect(parseRsvpCustomId(rsvpCustomId(GUILD_A.id, EVENT.id, 'no'))).toEqual({
      guildId: GUILD_A.id,
      eventId: EVENT.id,
      answer: 'no',
    });
    expect(parseRsvpCustomId('raid-rsvp:1:2:maybe')).toBeNull();
    expect(parseRsvpCustomId('loot-next')).toBeNull();
  });

  it('builds the DM with two buttons', () => {
    const message = rsvpMessage(raidGuild(), EVENT);
    expect(message.content).toContain('Molten Core');
    expect(message.components[0].toJSON().components.map((button) => button.custom_id)).toEqual([
      rsvpCustomId(GUILD_A.id, EVENT.id, 'yes'),
      rsvpCustomId(GUILD_A.id, EVENT.id, 'no'),
    ]);
  });
});

describe('handleRsvpButton', () => {
  it('"Can make it" links to the event and records the answer', async () => {
    const { interaction, store } = setup();
    store.recordMemberDm(GUILD_A.id, { eventId: EVENT.id, userId: USER_ID, startTime: 1 }, 1);
    await handleRsvpButton(interaction, NOW);

    expect(interaction.deferUpdate).toHaveBeenCalled();
    const { content, components } = interaction.editReply.mock.calls[0][0];
    expect(content).toContain(`https://discord.com/channels/${GUILD_A.id}/`);
    expect(components).toEqual([]);
    expect(store.db.prepare('SELECT answer FROM member_dms').get().answer).toBe('yes');
    expect(store.absentUserIds(GUILD_A.id, '2026-11-04').size).toBe(0);
  });

  it('"Can\'t make it" records an absence for the event\'s date', async () => {
    const { interaction, store } = setup({ answer: 'no' });
    await handleRsvpButton(interaction, NOW);

    expect(store.absentUserIds(GUILD_A.id, '2026-11-04')).toEqual(new Set([USER_ID]));
    expect(store.getAbsence(GUILD_A.id, 1)).toMatchObject({
      startsOn: '2026-11-04',
      endsOn: '2026-11-04',
      source: 'dm',
      createdBy: USER_ID,
    });
    expect(interaction.editReply.mock.calls[0][0].content).toContain('Wed Nov 4, 2026');
  });

  it('refuses an event that has started or no longer exists', async () => {
    const started = setup();
    await handleRsvpButton(started.interaction, seconds('2026-11-04T19:30:00Z') * 1000);
    expect(started.interaction.editReply).toHaveBeenCalledWith({
      content: STALE_MESSAGE,
      components: [],
    });

    const deleted = setup({ events: [] });
    await handleRsvpButton(deleted.interaction, NOW);
    expect(deleted.interaction.editReply.mock.calls[0][0].content).toBe(STALE_MESSAGE);
  });

  it("refuses an event from another server's ID", async () => {
    const { interaction } = setup({ events: [{ ...EVENT, serverId: GUILD_B.id }] });
    await handleRsvpButton(interaction, NOW);
    expect(interaction.editReply.mock.calls[0][0].content).toBe(STALE_MESSAGE);
  });

  it('accepts an event without a server ID in a configured channel', async () => {
    const { interaction, store } = setup({ answer: 'no', events: [{ ...EVENT, serverId: null }] });
    await handleRsvpButton(interaction, NOW);
    expect(store.absentUserIds(GUILD_A.id, '2026-11-04')).toEqual(new Set([USER_ID]));
  });

  it('refuses someone who is no longer a member', async () => {
    const { interaction, store } = setup({ member: null, answer: 'no' });
    await handleRsvpButton(interaction, NOW);
    expect(interaction.reply.mock.calls[0][0].content).toBe(UNAVAILABLE_MESSAGE);
    expect(store.getAbsence(GUILD_A.id, 1)).toBeNull();
  });

  it("refuses answers once the server's API key is gone", async () => {
    const { interaction, store } = setup({ answer: 'no' });
    interaction.client.raids.apiKeys = new Map();
    await handleRsvpButton(interaction, NOW);
    expect(interaction.reply.mock.calls[0][0].content).toBe(UNAVAILABLE_MESSAGE);
    expect(store.getAbsence(GUILD_A.id, 1)).toBeNull();
  });

  it('keeps the buttons when Raid-Helper cannot be reached', async () => {
    const { interaction, api } = setup();
    api.getEvent.mockRejectedValue(new RaidHelperError('timed out'));
    await handleRsvpButton(interaction, NOW);
    expect(interaction.followUp.mock.calls[0][0].content).toBe(RAID_HELPER_DOWN_MESSAGE);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('interactionCreate routing', () => {
  it('passes RSVP buttons to the handler and ignores other buttons', async () => {
    const rsvp = setup();
    await interactionCreate.execute(rsvp.interaction);
    expect(rsvp.interaction.deferUpdate).toHaveBeenCalled();

    const other = setup();
    other.interaction.customId = 'loot-next';
    await interactionCreate.execute(other.interaction);
    expect(other.interaction.deferUpdate).not.toHaveBeenCalled();
    expect(other.interaction.reply).not.toHaveBeenCalled();
  });
});
