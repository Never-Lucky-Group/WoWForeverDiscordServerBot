import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { respond } from '../src/lib/respond.js';

function fakeInteraction({ replied = false, deferred = false } = {}) {
  return {
    replied,
    deferred,
    reply: vi.fn(() => Promise.resolve()),
    editReply: vi.fn(() => Promise.resolve()),
    followUp: vi.fn(() => Promise.resolve()),
  };
}

const options = { content: 'Hello', flags: MessageFlags.Ephemeral };

describe('respond', () => {
  it('replies to a fresh interaction', async () => {
    const interaction = fakeInteraction();
    await respond(interaction, options);
    expect(interaction.reply).toHaveBeenCalledWith(options);
  });

  it('fills in a deferred reply instead of leaving the placeholder', async () => {
    const interaction = fakeInteraction({ deferred: true });
    await respond(interaction, options);
    expect(interaction.editReply).toHaveBeenCalledWith({ content: 'Hello' });
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('follows up once the interaction was replied to', async () => {
    const interaction = fakeInteraction({ deferred: true, replied: true });
    await respond(interaction, options);
    expect(interaction.followUp).toHaveBeenCalledWith(options);
  });
});
