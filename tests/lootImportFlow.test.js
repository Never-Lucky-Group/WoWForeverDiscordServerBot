import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import loot from '../src/commands/loot/loot.js';
import { MAX_FILE_BYTES } from '../src/loot/handlers/importExport.js';
import { fixtureEntries, fixtureText, memoryStore } from './helpers/loot.js';
import {
  LOOT_GUILD,
  fakeComponent,
  fakeLootInteraction,
  fakeOptions,
  lastMessage,
} from './helpers/lootInteraction.js';

const ATTACHMENT = {
  name: 'gargul.json',
  size: 4000,
  url: 'https://cdn.discordapp.com/attachments/1/2/gargul.json',
};
const INTERACTION_ID = '400000000000000001';
const ids = {
  session: (index) => `loot-import:session:${index}:${INTERACTION_ID}`,
  confirm: `loot-import:confirm:${INTERACTION_ID}`,
  cancel: `loot-import:cancel:${INTERACTION_ID}`,
};

let fileText;
beforeEach(() => {
  fileText = fixtureText();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(fileText) })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function runImport(store, { attachment = ATTACHMENT, guildConfig, replaceId } = {}) {
  const options =
    replaceId === undefined
      ? fakeOptions('import', { file: attachment })
      : fakeOptions('replace', { file: attachment, id: replaceId }, { group: 'imports' });
  const setup = fakeLootInteraction({ store, options, guildConfig });
  await loot.execute(setup.interaction, setup.context);
  return { ...setup, collector: setup.collectors[0] };
}

async function collect(collector, component) {
  const listeners = collector.listeners('collect');
  await Promise.all(listeners.map((listener) => listener(component)));
  return component;
}

// Imports the fixture as Molten Core + Onyxia.
async function importFixture(store) {
  const { collector } = await runImport(store);
  await collect(collector, fakeComponent(ids.session(0), { values: ['Molten Core'] }));
  await collect(collector, fakeComponent(ids.session(1), { values: ['Onyxia'] }));
  return collect(collector, fakeComponent(ids.confirm));
}

describe('/loot import', () => {
  it('previews the sessions with a dropdown each and Import/Cancel buttons', async () => {
    const { interaction, collector } = await runImport(memoryStore());
    expect(interaction.deferReply).toHaveBeenCalledOnce();
    const preview = lastMessage(interaction);
    expect(preview.content).toContain('Found **10** new awards in **2** raid sessions.');
    expect(preview.content).toContain('**Session 1:**');
    const rows = preview.components.map((row) => row.toJSON());
    expect(rows).toHaveLength(3);
    expect(rows[0].components[0].options.map((option) => option.value)).toEqual(LOOT_GUILD.raids);
    expect(rows[2].components.map((button) => button.label)).toEqual(['Import', 'Cancel']);
    expect(collector).toBeDefined();
  });

  it('stores the awards once every session has a raid', async () => {
    const store = memoryStore();
    const confirm = await importFixture(store);
    expect(confirm.update).toHaveBeenCalledWith({
      content: 'Imported **#1** (Molten Core, Onyxia): **10** new awards.',
      components: [],
    });
    expect(store.getImport(LOOT_GUILD.id, 1)?.sessions.map((session) => session.raid)).toEqual([
      'Molten Core',
      'Onyxia',
    ]);
  });

  it('asks for a raid for every session before importing', async () => {
    const store = memoryStore();
    const { collector } = await runImport(store);
    await collect(collector, fakeComponent(ids.session(1), { values: ['Onyxia'] }));
    const confirm = await collect(collector, fakeComponent(ids.confirm));
    expect(confirm.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Choose a raid for session 1 first.' }),
    );
    expect(store.listImports(LOOT_GUILD.id)).toEqual([]);
    expect(collector.ended).toBe(false);
  });

  it('pre-selects the raid suggested by earlier imports', async () => {
    const store = memoryStore();
    await importFixture(store);
    const entries = fixtureEntries().map((entry, index) => ({
      ...entry,
      checksum: `week2-${index}`,
      timestamp: entry.timestamp + 7 * 86400,
    }));
    fileText = JSON.stringify(entries);

    const { interaction, collector } = await runImport(store);
    const rows = lastMessage(interaction).components.map((row) => row.toJSON());
    const selected = rows
      .slice(0, 2)
      .map((row) => row.components[0].options.find((option) => option.default)?.value);
    expect(selected).toEqual(['Molten Core', 'Onyxia']);

    const confirm = await collect(collector, fakeComponent(ids.confirm));
    expect(confirm.update.mock.calls[0][0].content).toContain('Imported **#2**');
  });

  it('says the import was stored if only showing the result fails', async () => {
    const store = memoryStore();
    const { interaction, collector } = await runImport(store);
    await collect(collector, fakeComponent(ids.session(0), { values: ['Molten Core'] }));
    await collect(collector, fakeComponent(ids.session(1), { values: ['Onyxia'] }));
    const confirm = fakeComponent(ids.confirm);
    confirm.update.mockRejectedValue(new Error('Unknown interaction'));
    await collect(collector, confirm);
    expect(lastMessage(interaction).content).toMatch(/^The import was stored/);
    expect(store.listImports(LOOT_GUILD.id)).toHaveLength(1);
  });

  it('can be cancelled', async () => {
    const store = memoryStore();
    const { collector } = await runImport(store);
    const cancel = await collect(collector, fakeComponent(ids.cancel));
    expect(cancel.update).toHaveBeenCalledWith({
      content: 'Import cancelled. Nothing was stored.',
      components: [],
    });
    expect(store.listImports(LOOT_GUILD.id)).toEqual([]);
  });

  it('expires the prompt when nobody confirms in time', async () => {
    const { interaction, collector } = await runImport(memoryStore());
    collector.stop('time');
    expect(interaction.editReply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        message: '@original',
        content: expect.stringContaining('No raid was confirmed in time'),
        components: [],
      }),
    );
  });

  it('reports a file whose awards are all stored, with no prompt', async () => {
    const store = memoryStore();
    await importFixture(store);
    const { interaction, collectors } = await runImport(store);
    expect(lastMessage(interaction).content).toBe(
      'Nothing to import: all 10 awards in this file are already stored.',
    );
    expect(collectors).toEqual([]);
  });

  it('skips stored awards that changed and lists them as discrepancies', async () => {
    const store = memoryStore();
    await importFixture(store);
    const entries = fixtureEntries();
    entries[0].awardedTo = 'Jaina-WoWForever';
    entries[2].OS = false;
    fileText = JSON.stringify(entries);

    const { interaction } = await runImport(store);
    const { content } = lastMessage(interaction);
    expect(content).toContain('⚠️ **2 already-stored awards differ from this file.**');
    expect(content).toContain('/loot imports replace');
    expect(content).toContain(
      '**Arcanist Boots** (<t:1794339720:d>, import #1): winner: Thrall-WoWForever → Jaina-WoWForever',
    );
    expect(content).toContain('**Arcanist Crown**');
    expect(content).toContain('off spec: yes → no');
    expect(store.characterAwards(LOOT_GUILD.id, 'Thrall')).toHaveLength(3);
  });

  it('rejects a file with too many sessions', async () => {
    const entries = fixtureEntries().map((entry, index) => ({
      ...entry,
      timestamp: entry.timestamp + index * 7 * 3600,
    }));
    fileText = JSON.stringify(entries);
    const { interaction, collectors } = await runImport(memoryStore());
    expect(lastMessage(interaction).content).toMatch(/has 10 raid sessions .* at most 4/);
    expect(collectors).toEqual([]);
  });

  it('explains how to export JSON when the file is a CSV', async () => {
    fileText = 'dateTime,character,itemID,offspec,id\n2026-11-10,Thrall,16800,0,abc';
    const { interaction } = await runImport(memoryStore());
    expect(lastMessage(interaction).content).toMatch(/Detailed \(JSON\)/);
  });

  it('refuses files over the size limit without downloading them', async () => {
    const { interaction } = await runImport(memoryStore(), {
      attachment: { ...ATTACHMENT, size: MAX_FILE_BYTES + 1 },
    });
    expect(lastMessage(interaction).content).toMatch(/too large/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('needs a raid list in the config', async () => {
    const { interaction } = await runImport(memoryStore(), {
      guildConfig: { ...LOOT_GUILD, raids: undefined },
    });
    expect(lastMessage(interaction).content).toMatch(/No raids are configured/);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('/loot imports replace', () => {
  it("replaces an import's awards with the new file's", async () => {
    const store = memoryStore();
    await importFixture(store);
    const entries = fixtureEntries().slice(0, 7);
    entries[0].awardedTo = 'Jaina-WoWForever';
    fileText = JSON.stringify(entries);

    const { interaction, collector } = await runImport(store, { replaceId: 1 });
    expect(lastMessage(interaction).content).toContain(
      'Replace import **#1** with **7** awards in **1** raid session.',
    );
    await collect(collector, fakeComponent(ids.session(0), { values: ['Molten Core'] }));
    const confirm = await collect(collector, fakeComponent(ids.confirm));
    expect(confirm.update.mock.calls[0][0].content).toBe(
      'Replaced **#1** (Molten Core): removed 10, stored **7** awards.',
    );
    expect(store.characterAwards(LOOT_GUILD.id, 'Thrall')).toHaveLength(1);
    expect(store.getImport(LOOT_GUILD.id, 1)?.awardCount).toBe(7);
  });

  it('reports an unknown import', async () => {
    const { interaction } = await runImport(memoryStore(), { replaceId: 7 });
    expect(lastMessage(interaction).content).toBe('Import #7 was not found.');
    expect(fetch).not.toHaveBeenCalled();
  });
});
