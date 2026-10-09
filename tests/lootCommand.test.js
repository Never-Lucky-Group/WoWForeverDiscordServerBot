import { describe, expect, it } from 'vitest';
import loot, {
  NOT_CONFIGURED_MESSAGE,
  STORE_UNAVAILABLE_MESSAGE,
} from '../src/commands/loot/loot.js';
import { NO_PERMISSION_MESSAGE } from '../src/handlers/commandInteraction.js';
import { PAGE_SIZE, paginate } from '../src/loot/discord/pager.js';
import { splitIntoSessions } from '../src/loot/sessions.js';
import { GUILD_A } from './helpers/fakes.js';
import { fixtureAwards, memoryStore } from './helpers/loot.js';
import {
  LOOT_GUILD,
  fakeComponent,
  fakeLootInteraction,
  fakeOptions,
  lastMessage,
} from './helpers/lootInteraction.js';

const INTERACTION_ID = '400000000000000001';

function storeWithFixture() {
  const store = memoryStore();
  const sessions = splitIntoSessions(fixtureAwards()).map((session, index) => ({
    ...session,
    raid: LOOT_GUILD.raids[index],
  }));
  store.createImport({
    guildId: LOOT_GUILD.id,
    uploadedBy: '300000000000000001',
    fileName: 'export.json',
    sessions,
    now: 1_800_000_000,
  });
  return store;
}

async function run(subcommand, values, { store = storeWithFixture(), group, ...rest } = {}) {
  const setup = fakeLootInteraction({
    store,
    options: fakeOptions(subcommand, values, { group }),
    ...rest,
  });
  await loot.execute(setup.interaction, setup.context);
  return { ...setup, store, sent: lastMessage(setup.interaction) };
}

describe('/loot definition', () => {
  it('registers as an Officer command with every subcommand', () => {
    const json = loot.data.toJSON();
    expect(json).toMatchObject({
      name: 'loot',
      contexts: [0],
      integration_types: [0],
      default_member_permissions: '0',
    });
    expect(json.options.map((option) => option.name)).toEqual([
      'import',
      'imports',
      'character',
      'item',
      'raid',
      'leaderboard',
    ]);
  });
});

describe('/loot permissions', () => {
  it('needs the loot role as well as the Officer role', async () => {
    const { sent, interaction } = await run('leaderboard', {}, { roles: [GUILD_A.officerRoleId] });
    expect(sent.content).toBe(NO_PERMISSION_MESSAGE);
    expect(interaction.reply.mock.calls[0][0].flags).toBeDefined();
  });

  it('is disabled when the server has no loot role', async () => {
    const { sent } = await run('leaderboard', {}, { guildConfig: GUILD_A });
    expect(sent.content).toBe(NOT_CONFIGURED_MESSAGE);
  });

  it('is disabled when the database could not be opened', async () => {
    const { sent } = await run('leaderboard', {}, { store: null });
    expect(sent.content).toBe(STORE_UNAVAILABLE_MESSAGE);
  });
});

describe('/loot queries', () => {
  it('lists the items a character received', async () => {
    const { sent } = await run('character', { name: 'thrall' });
    const lines = sent.content.split('\n');
    expect(lines[0]).toBe('**Thrall-WoWForever** received **3 items**.');
    expect(lines[1]).toBe('<t:1794339720:d> **Arcanist Boots** · Molten Core (SR)');
    expect(lines[2]).toContain('**Arcanist Crown** · Molten Core (OS)');
    expect(lines[3]).toContain('**Head of Onyxia** · Onyxia');
    const buttons = sent.components[0].toJSON().components.map((button) => button.label);
    expect(buttons).toEqual(['Download CSV']);
    expect(sent.allowedMentions).toEqual({ parse: [] });
  });

  it('describes and applies filters', async () => {
    const { sent } = await run('character', {
      name: 'Thrall',
      raid: 'Molten Core',
      from: '2026-11-01',
      to: '2026-11-10',
      type: 'main-spec',
    });
    expect(sent.content.split('\n')[0]).toBe(
      '**Thrall-WoWForever** received **1 item** in **Molten Core** from 2026-11-01 to 2026-11-10 ' +
        '(main spec only).',
    );
  });

  it('rejects weeks combined with dates', async () => {
    const { sent } = await run('character', { name: 'Thrall', weeks: 2, from: '2026-11-01' });
    expect(sent.content).toBe('Use either `weeks` or `from`/`to`, not both.');
  });

  it('rejects malformed dates and reversed ranges', async () => {
    expect((await run('leaderboard', { from: '11/01/2026' })).sent.content).toMatch(
      /`from` must be a date/,
    );
    expect((await run('leaderboard', { from: '2026-11-10', to: '2026-11-01' })).sent.content).toBe(
      '`from` must be on or before `to`.',
    );
  });

  it('says when a character has no awards', async () => {
    const { sent } = await run('character', { name: 'Arthas' });
    expect(sent.content).toContain('**Arthas** received **0 items**');
    expect(sent.content).toContain('No awards found.');
    expect(sent.components).toBeUndefined();
  });

  it('lists who received an item', async () => {
    const { sent } = await run('item', { name: '17182' });
    expect(sent.content.split('\n')[0]).toBe(
      '**Sulfuras, Hand of Ragnaros** was awarded **1 time**.',
    );
    expect(sent.content).toContain('**Garrosh-WoWForever** · Molten Core (PL)');
  });

  it('names the item even when the filters match nothing', async () => {
    const { sent } = await run('item', { name: '17182', raid: 'Onyxia' });
    expect(sent.content.split('\n')[0]).toBe(
      '**Sulfuras, Hand of Ragnaros** was awarded **0 times** in **Onyxia**.',
    );
  });

  it('summarises a raid session including disenchanted items', async () => {
    const store = storeWithFixture();
    const [session] = store.getImport(LOOT_GUILD.id, 1)?.sessions ?? [];
    const { sent } = await run('raid', { session: String(session.id) }, { store });
    expect(sent.content.split('\n')[0]).toMatch(
      /^\*\*Molten Core\*\* · .* · \*\*7\*\* items \(import #1\)$/,
    );
    expect(sent.content).toContain('**Plans: Elemental Sharpening Stone** → Disenchanted');
  });

  it('reports an unknown raid session', async () => {
    const { sent } = await run('raid', { session: 'Molten Core' });
    expect(sent.content).toMatch(/Raid session not found/);
  });

  it('ranks characters on the leaderboard', async () => {
    const { sent } = await run('leaderboard', { raid: 'Onyxia' });
    expect(sent.content.split('\n')).toEqual([
      '**Loot leaderboard** in **Onyxia**:',
      '1. **Jaina-WoWForever** · 1 item',
      '2. **Sylvanas-WoWForever** · 1 item',
      '3. **Thrall-WoWForever** · 1 item',
    ]);
  });

  it('sends the full result as CSV on request', async () => {
    const { collectors } = await run('character', { name: 'Thrall' });
    const button = fakeComponent(`loot-page:csv:${INTERACTION_ID}`);
    await Promise.all(collectors[0].listeners('collect').map((listener) => listener(button)));
    const [{ files }] = button.reply.mock.calls[0];
    const csv = files[0].attachment.toString('utf8');
    expect(files[0].name).toBe('loot-Thrall.csv');
    expect(csv.split('\r\n')[0]).toMatch(/^awarded_at,character,realm,item_id,item,raid/);
    expect(csv.split('\r\n')).toHaveLength(5);
  });
});

describe('paging', () => {
  it('splits long results into pages', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`);
    expect(paginate(lines).map((page) => page.length)).toEqual([PAGE_SIZE, PAGE_SIZE, 10]);
  });

  it('keeps each page under the character budget', () => {
    const lines = Array.from({ length: 10 }, () => 'x'.repeat(400));
    for (const page of paginate(lines)) {
      expect(page.join('\n').length).toBeLessThanOrEqual(1500);
    }
  });

  it('moves between pages with the buttons', async () => {
    const store = memoryStore();
    const award = fixtureAwards()[0];
    const awards = Array.from({ length: 20 }, (_, i) => ({
      ...award,
      checksum: `c${i}`,
      awardedAt: award.awardedAt + i * 60,
    }));
    store.createImport({
      guildId: LOOT_GUILD.id,
      uploadedBy: '1',
      fileName: 'a.json',
      sessions: [{ raid: 'Molten Core', startedAt: 0, endedAt: 0, awards }],
    });
    const { sent, collectors } = await run('character', { name: 'Thrall' }, { store });
    expect(sent.content).toContain('-# Page 1 of 2');
    const labels = sent.components[0].toJSON().components.map((b) => [b.label, b.disabled]);
    expect(labels).toEqual([
      ['Previous', true],
      ['Next', false],
      ['Download CSV', undefined],
    ]);

    const next = fakeComponent(`loot-page:next:${INTERACTION_ID}`);
    await Promise.all(collectors[0].listeners('collect').map((listener) => listener(next)));
    expect(next.update.mock.calls[0][0].content).toContain('-# Page 2 of 2');
  });

  it('removes the buttons when they expire', async () => {
    const { interaction, collectors } = await run('character', { name: 'Thrall' });
    collectors[0].stop('time');
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ message: '@original', components: [] }),
    );
  });
});

describe('/loot imports', () => {
  it('lists imports', async () => {
    const { sent } = await run('list', {}, { group: 'imports' });
    expect(sent.content).toContain('**Gargul imports** (1), newest first:');
    expect(sent.content).toContain(
      '**#1** · Molten Core <t:1794339720:d>, Onyxia <t:1794513900:d> · 10 items · ' +
        'uploaded <t:1800000000:d> by <@300000000000000001> · `export.json`',
    );
  });

  it('deletes an import after confirmation', async () => {
    const store = storeWithFixture();
    const setup = fakeLootInteraction({
      store,
      options: fakeOptions('delete', { id: 1 }, { group: 'imports' }),
    });
    const confirm = fakeComponent(`loot-delete:confirm:${INTERACTION_ID}`);
    setup.message.awaitMessageComponent.mockResolvedValue(confirm);
    await loot.execute(setup.interaction, setup.context);
    expect(lastMessage(setup.interaction).content).toMatch(/^Delete this import/);
    expect(confirm.update).toHaveBeenCalledWith({
      content: 'Deleted import #1 and its 10 awards.',
      components: [],
    });
    expect(store.listImports(LOOT_GUILD.id)).toEqual([]);
  });

  it('keeps the import when cancelled or timed out', async () => {
    const store = storeWithFixture();
    const cancelled = fakeLootInteraction({
      store,
      options: fakeOptions('delete', { id: 1 }, { group: 'imports' }),
    });
    const cancel = fakeComponent(`loot-delete:cancel:${INTERACTION_ID}`);
    cancelled.message.awaitMessageComponent.mockResolvedValue(cancel);
    await loot.execute(cancelled.interaction, cancelled.context);
    expect(cancel.update).toHaveBeenCalledWith({ content: 'Nothing was deleted.', components: [] });

    const timedOut = fakeLootInteraction({
      store,
      options: fakeOptions('delete', { id: 1 }, { group: 'imports' }),
    });
    timedOut.message.awaitMessageComponent.mockRejectedValue(new Error('time'));
    await loot.execute(timedOut.interaction, timedOut.context);
    expect(lastMessage(timedOut.interaction).content).toMatch(/timed out/);
    expect(store.listImports(LOOT_GUILD.id)).toHaveLength(1);
  });

  it('reports an unknown import', async () => {
    const { sent } = await run('delete', { id: 5 }, { group: 'imports' });
    expect(sent.content).toBe('Import #5 was not found.');
  });
});

describe('/loot autocomplete', () => {
  async function suggest(subcommand, focused, { group, roles } = {}) {
    const setup = fakeLootInteraction({
      store: storeWithFixture(),
      options: fakeOptions(subcommand, {}, { group, focused }),
      roles,
    });
    await loot.autocomplete(setup.interaction, setup.context);
    return setup.interaction.respond.mock.calls[0][0];
  }

  it('suggests characters, items, raids, sessions and imports', async () => {
    expect(await suggest('character', { name: 'name', value: 'th' })).toEqual([
      { name: 'Thrall-WoWForever', value: 'Thrall-WoWForever' },
    ]);
    expect(await suggest('item', { name: 'name', value: 'sulf' })).toEqual([
      { name: 'Sulfuras, Hand of Ragnaros (17182)', value: '17182' },
    ]);
    expect(await suggest('leaderboard', { name: 'raid', value: 'ony' })).toEqual([
      { name: 'Onyxia', value: 'Onyxia' },
    ]);
    const sessions = await suggest('raid', { name: 'session', value: 'molten' });
    expect(sessions).toEqual([
      { name: '2026-11-10 Molten Core · 7 items · import #1', value: expect.any(String) },
    ]);
    expect(await suggest('delete', { name: 'id', value: '' }, { group: 'imports' })).toEqual([
      { name: '#1 · 2026-11-10 · Molten Core, Onyxia · 10 items', value: 1 },
    ]);
  });

  it('suggests nothing without the loot role', async () => {
    expect(
      await suggest('character', { name: 'name', value: '' }, { roles: [GUILD_A.officerRoleId] }),
    ).toEqual([]);
  });
});
