// Client for Raid-Helper's HTTP API (documented at https://raid-helper.xyz/documentation/api).
// Server requests need the server's API key, which Raid-Helper's /apikey command shows. The key is
// sent as the Authorization header and never logged.

export const RAID_HELPER_API_URL = 'https://raid-helper.xyz/api/v4';
const TIMEOUT_MS = 15_000;
// A page holds up to 1000 events; more than this many pages means something is wrong.
const MAX_PAGES = 5;
const ERROR_TEXT_LIMIT = 200;

export class RaidHelperError extends Error {
  name = 'RaidHelperError';

  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.status = status;
  }
}

// A sign-up as the bot uses it. userId is null for a sign-up added by name only.
//   { userId, name, className, status }
// An event as the bot uses it:
//   { id, serverId, channelId, leaderId, templateId, title, startTime, closeTime, signUps }
// closeTime is null when the event never closes sign-ups.
export function normalizeEvent(raw, serverId = null) {
  if (!raw || raw.id === undefined || !Number.isFinite(Number(raw.startTime))) return null;
  // The event list calls it closeTime, a single event closingTime.
  const closeTime = Number(raw.closeTime ?? raw.closingTime);
  return {
    id: String(raw.id),
    serverId: raw.serverId !== undefined ? String(raw.serverId) : serverId,
    channelId: raw.channelId !== undefined ? String(raw.channelId) : null,
    leaderId: raw.leaderId ? String(raw.leaderId) : null,
    templateId: raw.templateId ? String(raw.templateId) : null,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Untitled event',
    startTime: Number(raw.startTime),
    closeTime: Number.isFinite(closeTime) && closeTime > 0 ? closeTime : null,
    signUps: (Array.isArray(raw.signUps) ? raw.signUps : []).map((signUp) => ({
      userId: signUp.userId ? String(signUp.userId) : null,
      name: typeof signUp.name === 'string' ? signUp.name : '',
      className: typeof signUp.className === 'string' ? signUp.className : '',
      status: typeof signUp.status === 'string' ? signUp.status : '',
    })),
  };
}

export class RaidHelperClient {
  constructor({
    fetch = globalThis.fetch,
    baseUrl = RAID_HELPER_API_URL,
    timeoutMs = TIMEOUT_MS,
  } = {}) {
    this.fetch = fetch;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  // The server's events starting between startTime and endTime (Unix seconds), with sign-ups.
  async listEvents(serverId, apiKey, { startTime, endTime }) {
    const events = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await this.request(`/servers/${serverId}/events`, {
        headers: {
          Authorization: apiKey,
          IncludeSignUps: 'true',
          StartTimeFilter: String(startTime),
          EndTimeFilter: String(endTime),
          Page: String(page),
        },
      });
      const posted = Array.isArray(body?.postedEvents) ? body.postedEvents : [];
      for (const raw of posted) {
        const event = normalizeEvent(raw, serverId);
        if (event) events.push(event);
      }
      if (page >= Number(body?.pages ?? 1)) break;
    }
    return events;
  }

  // One event with its sign-ups, or null if Raid-Helper does not know it. Needs no API key.
  async getEvent(eventId) {
    try {
      return normalizeEvent(await this.request(`/events/${encodeURIComponent(eventId)}`));
    } catch (error) {
      if (error instanceof RaidHelperError && error.status === 404) return null;
      throw error;
    }
  }

  // Posts a new event in a channel and returns it. Only settings that work without Raid-Helper
  // Premium are sent.
  async createEvent(
    serverId,
    channelId,
    apiKey,
    { leaderId, templateId, startTime, title, description },
  ) {
    const body = await this.request(`/servers/${serverId}/channels/${channelId}/event`, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaderId,
        templateId,
        // Raid-Helper takes a Unix timestamp for both, which avoids the server's date format.
        date: String(startTime),
        time: String(startTime),
        title,
        ...(description && { description }),
      }),
    });
    const event = normalizeEvent(body?.event, serverId);
    if (!event) throw new RaidHelperError('Raid-Helper did not return the new event');
    return event;
  }

  async request(path, { method = 'GET', headers = {}, body } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? 'timed out' : 'failed';
      throw new RaidHelperError(`Raid-Helper request ${reason}`, { cause: error });
    }

    const text = await response.text();
    if (!response.ok) {
      throw new RaidHelperError(
        `Raid-Helper returned HTTP ${response.status}: ${text.slice(0, ERROR_TEXT_LIMIT)}`,
        { status: response.status },
      );
    }
    try {
      return text ? JSON.parse(text) : null;
    } catch (error) {
      throw new RaidHelperError('Raid-Helper returned a response that is not JSON', {
        status: response.status,
        cause: error,
      });
    }
  }
}
