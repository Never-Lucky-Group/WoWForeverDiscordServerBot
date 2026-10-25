import { describe, expect, it, vi } from 'vitest';
import {
  RAID_HELPER_API_URL,
  RaidHelperClient,
  RaidHelperError,
  normalizeEvent,
} from '../src/raids/apiClient.js';
import { GUILD_A } from './helpers/fakes.js';

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

const RAW_EVENT = {
  id: '800000000000000001',
  channelId: '720000000000000001',
  leaderId: '730000000000000001',
  templateId: 'wowforever',
  title: 'Molten Core',
  startTime: 1793820600,
  closeTime: 1793777400,
  signUps: [
    { userId: '300000000000000001', name: 'Thrall', className: 'Warrior', status: 'primary' },
    { name: 'Fake', className: 'Tentative', status: 'primary' },
  ],
};

describe('normalizeEvent', () => {
  it('keeps the fields the bot uses', () => {
    expect(normalizeEvent(RAW_EVENT, GUILD_A.id)).toEqual({
      id: '800000000000000001',
      serverId: GUILD_A.id,
      channelId: '720000000000000001',
      leaderId: '730000000000000001',
      templateId: 'wowforever',
      title: 'Molten Core',
      startTime: 1793820600,
      closeTime: 1793777400,
      signUps: [
        { userId: '300000000000000001', name: 'Thrall', className: 'Warrior', status: 'primary' },
        { userId: null, name: 'Fake', className: 'Tentative', status: 'primary' },
      ],
    });
  });

  it("reads a single event's closingTime and serverId", () => {
    const event = normalizeEvent({
      ...RAW_EVENT,
      closeTime: undefined,
      closingTime: 1793777400,
      serverId: GUILD_A.id,
    });
    expect(event).toMatchObject({ serverId: GUILD_A.id, closeTime: 1793777400 });
  });

  it('treats a missing close time as none and fills in a missing title', () => {
    expect(
      normalizeEvent({ ...RAW_EVENT, closeTime: undefined, title: ' ', signUps: undefined }),
    ).toMatchObject({ closeTime: null, title: 'Untitled event', signUps: [] });
  });

  it('rejects events without an ID or start time', () => {
    expect(normalizeEvent({ ...RAW_EVENT, id: undefined })).toBeNull();
    expect(normalizeEvent({ ...RAW_EVENT, startTime: 'soon' })).toBeNull();
    expect(normalizeEvent(null)).toBeNull();
  });
});

describe('RaidHelperClient', () => {
  it('lists events with sign-ups, sending the API key and filters as headers', async () => {
    const fetch = vi.fn(async () => jsonResponse({ pages: 1, postedEvents: [RAW_EVENT] }));
    const client = new RaidHelperClient({ fetch });

    const events = await client.listEvents(GUILD_A.id, 'key', { startTime: 10, endTime: 20 });

    expect(events.map((event) => event.id)).toEqual([RAW_EVENT.id]);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${RAID_HELPER_API_URL}/servers/${GUILD_A.id}/events`);
    expect(init.headers).toEqual({
      Authorization: 'key',
      IncludeSignUps: 'true',
      StartTimeFilter: '10',
      EndTimeFilter: '20',
      Page: '1',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('reads every page', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ pages: 2, postedEvents: [RAW_EVENT] }))
      .mockResolvedValueOnce(
        jsonResponse({ pages: 2, postedEvents: [{ ...RAW_EVENT, id: '800000000000000002' }] }),
      );
    const client = new RaidHelperClient({ fetch });
    const events = await client.listEvents(GUILD_A.id, 'key', { startTime: 0, endTime: 1 });
    expect(events).toHaveLength(2);
    expect(fetch.mock.calls[1][1].headers.Page).toBe('2');
  });

  it('gets one event without an API key, or null if it does not exist', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ...RAW_EVENT, serverId: GUILD_A.id }))
      .mockResolvedValueOnce(jsonResponse({ status: 'failed' }, 404));
    const client = new RaidHelperClient({ fetch });

    expect(await client.getEvent(RAW_EVENT.id)).toMatchObject({ id: RAW_EVENT.id });
    expect(fetch.mock.calls[0][0]).toBe(`${RAID_HELPER_API_URL}/events/${RAW_EVENT.id}`);
    expect(fetch.mock.calls[0][1].headers).toEqual({});
    expect(await client.getEvent('1')).toBeNull();
  });

  it('creates an event with Unix timestamps and no Premium settings', async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: 'success', event: RAW_EVENT }));
    const client = new RaidHelperClient({ fetch });

    const event = await client.createEvent(GUILD_A.id, RAW_EVENT.channelId, 'key', {
      leaderId: RAW_EVENT.leaderId,
      templateId: 'wowclassic',
      startTime: RAW_EVENT.startTime,
      title: 'Molten Core',
    });

    expect(event.id).toBe(RAW_EVENT.id);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(
      `${RAID_HELPER_API_URL}/servers/${GUILD_A.id}/channels/${RAW_EVENT.channelId}/event`,
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'key', 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      leaderId: RAW_EVENT.leaderId,
      templateId: 'wowclassic',
      date: String(RAW_EVENT.startTime),
      time: String(RAW_EVENT.startTime),
      title: 'Molten Core',
    });
  });

  it('fails when the created event is missing from the reply', async () => {
    const client = new RaidHelperClient({ fetch: async () => jsonResponse({ status: 'success' }) });
    await expect(
      client.createEvent(GUILD_A.id, '1', 'key', { startTime: 1, title: 'x' }),
    ).rejects.toThrow(RaidHelperError);
  });

  it('turns HTTP errors into RaidHelperError with the status', async () => {
    const client = new RaidHelperClient({
      fetch: async () => jsonResponse({ reason: 'Unauthorized' }, 401),
    });
    const error = await client
      .listEvents(GUILD_A.id, 'key', { startTime: 0, endTime: 1 })
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(RaidHelperError);
    expect(error.status).toBe(401);
    expect(error.message).not.toContain('key');
  });

  it('turns timeouts and network errors into RaidHelperError', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const client = new RaidHelperClient({ fetch: () => Promise.reject(timeout) });
    await expect(client.getEvent('1')).rejects.toThrow('Raid-Helper request timed out');
  });

  it('rejects a reply that is not JSON', async () => {
    const client = new RaidHelperClient({
      fetch: async () => ({ ok: true, status: 200, text: async () => '<html>' }),
    });
    await expect(client.getEvent('1')).rejects.toThrow(RaidHelperError);
  });
});
