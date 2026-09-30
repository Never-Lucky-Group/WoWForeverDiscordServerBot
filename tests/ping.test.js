import { describe, expect, it, vi } from 'vitest';
import ping from '../src/commands/utility/ping.js';

function setup({ ping: latency, replied = false }) {
  const interaction = {
    client: { ws: { ping: latency } },
    replied,
    deferred: false,
    reply: vi.fn(() => Promise.resolve()),
    followUp: vi.fn(() => Promise.resolve()),
  };
  const context = { guild: { name: 'Guild A' } };
  return { interaction, run: () => ping.execute(interaction, context) };
}

describe('/ping', () => {
  it('registers as an Officer command usable in servers only', () => {
    expect(ping.data.toJSON()).toMatchObject({
      name: 'ping',
      contexts: [0], // Guild
      integration_types: [0], // GuildInstall
      default_member_permissions: '0',
    });
  });

  it('replies with the latency and the resolved server', async () => {
    const { interaction, run } = setup({ ping: 42 });
    await run();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Pong! Gateway latency: 42ms. Server: **Guild A**.' }),
    );
  });

  it('handles latency that has not been measured yet', async () => {
    const { interaction, run } = setup({ ping: -1 });
    await run();
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('not measured yet') }),
    );
  });

  it('follows up when the initial reply was already used', async () => {
    const { interaction, run } = setup({ ping: 42, replied: true });
    await run();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).toHaveBeenCalledOnce();
  });
});
