import { readFile } from 'node:fs/promises';
import { Collection, MessageFlags, RESTJSONErrorCodes } from 'discord.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import faqCommand from '../src/commands/utility/faq.js';
import interactionCreate from '../src/events/interactionCreate.js';
import {
  FAQ_PATH,
  FaqError,
  MAX_SECTIONS,
  MESSAGE_LIMIT,
  NOTICE_ROOM,
  contentsText,
  headingAnchor,
  loadFaq,
  parseFaq,
  sectionText,
} from '../src/faq/faq.js';
import {
  DMS_CLOSED_NOTICE,
  SECTION_GONE_NOTICE,
  UNAVAILABLE_MESSAGE,
  faqCustomId,
  handleFaqSelect,
  parseFaqCustomId,
  visibleSections,
} from '../src/faq/menu.js';
import { loadCommands } from '../src/loaders/commands.js';
import { GUILD_A, USER_ID, fakeMember, makeBotConfig } from './helpers/fakes.js';
import { LOOT_GUILD, LOOT_ROLE_ID } from './helpers/lootInteraction.js';
import { RAIDER_ROLE_ID, RAID_GUILD, raidsClient } from './helpers/raids.js';

const SAMPLE = `# FAQ

Intro text.

## For everyone

### Question one?

Answer one.

## Loot help
<!-- commands: loot, ping -->

### How do I import?

\`\`\`
## Not a section
\`\`\`
`;

let commands;
let realFaq;
beforeAll(async () => {
  commands = await loadCommands();
  realFaq = await loadFaq();
});

describe('parseFaq', () => {
  it('reads the title, intro, sections and their command markers', () => {
    const faq = parseFaq(SAMPLE);
    expect(faq.title).toBe('FAQ');
    expect(faq.intro).toBe('Intro text.');
    expect(faq.sections).toEqual([
      {
        id: 'for-everyone',
        title: 'For everyone',
        commands: [],
        markdown: '## For everyone\n### Question one?\n\nAnswer one.',
      },
      {
        id: 'loot-help',
        title: 'Loot help',
        commands: ['loot', 'ping'],
        markdown: '## Loot help\n### How do I import?\n\n```\n## Not a section\n```',
      },
    ]);
  });

  it('accepts Windows line endings', () => {
    expect(parseFaq(SAMPLE.replaceAll('\n', '\r\n')).sections).toHaveLength(2);
  });

  it.each([
    ['no title', '## Section\ntext', /start with a "# " title/],
    ['text before the title', 'Hello\n# FAQ\n## Section\ntext', /start with a "# " title/],
    ['a second title', '# FAQ\n## Section\ntext\n# Again', /second "# " title/],
    ['no sections', '# FAQ\nJust an intro.', /no "## " sections/],
    ['an empty section', '# FAQ\n## Empty\n\n## Full\ntext', /"Empty" is empty/],
    ['a section with only a marker', '# FAQ\n## Marked\n<!-- commands: loot -->', /is empty/],
    ['two sections with one anchor', '# FAQ\n## Loot!\na\n## loot\nb', /unlike the others/],
    ['a title without letters', '# FAQ\n## ???\ntext', /unlike the others/],
    [
      'a marker after the first line',
      '# FAQ\n## S\ntext\n<!-- commands: loot -->',
      /not its first/,
    ],
    ['a comment in the intro', '# FAQ\n<!-- note -->\n## S\ntext', /intro must not/],
    ['an empty command name', '# FAQ\n## S\n<!-- commands: loot, -->\ntext', /empty command/],
    ['a title over 100 characters', `# FAQ\n## ${'t'.repeat(101)}\ntext`, /over 100/],
  ])('rejects %s', (_label, text, message) => {
    expect(() => parseFaq(text)).toThrow(FaqError);
    expect(() => parseFaq(text)).toThrow(message);
  });

  it('rejects more sections than a dropdown holds', () => {
    const sections = Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => `## S${i}\ntext`);
    expect(() => parseFaq(`# FAQ\n${sections.join('\n')}`)).toThrow(/26 sections/);
  });

  it('rejects a section too long for one Discord message', () => {
    expect(() => parseFaq(`# FAQ\n## Long\n${'x'.repeat(MESSAGE_LIMIT)}`)).toThrow(
      /"Long" is \d+ characters in Discord/,
    );
  });

  it('rejects an intro that leaves no room in the contents message', () => {
    expect(() => parseFaq(`# FAQ\n${'x'.repeat(MESSAGE_LIMIT)}\n## S\ntext`)).toThrow(
      /shorten the intro/,
    );
  });

  it('reports a missing file as a FaqError', async () => {
    await expect(loadFaq('/nonexistent/faq.md')).rejects.toThrow(FaqError);
  });
});

describe('headingAnchor', () => {
  it("matches GitHub's heading anchors", () => {
    expect(headingAnchor('Getting started')).toBe('getting-started');
    expect(headingAnchor('Weekly raids & changes')).toBe('weekly-raids--changes');
    expect(headingAnchor("Can't see /loot?")).toBe('cant-see-loot');
  });
});

describe('the FAQ in Discord', () => {
  it('sends each section as it is written', () => {
    const [section] = parseFaq(SAMPLE).sections;
    expect(sectionText(section)).toBe('## For everyone\n### Question one?\n\nAnswer one.');
  });

  it('turns off link previews for web links in the intro and sections', () => {
    const faq = parseFaq(
      '# FAQ\nSee [A](https://a.example).\n## S\n[B](http://b.example/x) and [C](<https://c.example>)',
    );
    expect(faq.intro).toBe('See [A](<https://a.example>).');
    expect(faq.sections[0].markdown).toBe(
      '## S\n[B](<http://b.example/x>) and [C](<https://c.example>)',
    );
  });

  it('lists the sections under the notice and intro', () => {
    const faq = parseFaq(SAMPLE);
    expect(contentsText(faq, faq.sections, '**Notice**')).toBe(
      '**Notice**\n\n## FAQ\n\nIntro text.\n\n- For everyone\n- Loot help\n\n' +
        'Choose a section from the list below.',
    );
    expect(contentsText(faq, [])).toContain('There are no sections for you here yet.');
  });

  it('has notices that fit in the room left for them', () => {
    for (const notice of [DMS_CLOSED_NOTICE, SECTION_GONE_NOTICE]) {
      expect(notice.length + 2).toBeLessThanOrEqual(NOTICE_ROOM);
    }
  });
});

describe('docs/faq.md', () => {
  let text;
  beforeAll(async () => {
    text = await readFile(FAQ_PATH, 'utf8');
  });

  it('fits every section in one Discord message', () => {
    expect(realFaq.sections.length).toBeGreaterThan(0);
    for (const section of realFaq.sections) {
      expect(sectionText(section).length, section.title).toBeLessThanOrEqual(MESSAGE_LIMIT);
    }
  });

  it('names only real commands in its markers', () => {
    for (const section of realFaq.sections) {
      for (const name of section.commands) expect(commands.has(name), section.title).toBe(true);
    }
  });

  // GitHub numbers repeated anchors (-1, -2, ...), which would break the links to sections.
  it('gives every heading its own anchor on GitHub', () => {
    const headings = [...text.replace(/```[\s\S]*?```/g, '').matchAll(/^#{1,3} +(.+?)\s*$/gm)];
    const anchors = headings.map((heading) => headingAnchor(heading[1]));
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it('has a section for everyone', () => {
    expect(realFaq.sections.some((section) => section.commands.length === 0)).toBe(true);
  });

  // Markdown that GitHub and Discord show differently, outside code.
  it.each([
    ['a table', /^\s*\|.*\|\s*$/m],
    ['an image', /!\[[^\]]*\]\(/],
    ['a heading deeper than ###', /^#{4,} /m],
    ['HTML other than a commands marker', /<(?!!--\s*commands:)[!/a-z][^>]*>/i],
    ['a relative link', /\]\((?!https?:\/\/)[^)]*\)/],
    ['__underline__, which GitHub shows as bold', /__\S/],
    ['Discord-only subtext', /^-# /m],
    ['Discord-only spoilers', /\|\|/],
  ])('uses no %s', (_label, pattern) => {
    const outsideCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    expect(outsideCode).not.toMatch(pattern);
  });
});

describe('visibleSections', () => {
  const faq = parseFaq(SAMPLE);
  const titles = (member, guildConfig = LOOT_GUILD) =>
    visibleSections(faq, commands, member, guildConfig).map((section) => section.title);

  it('shows marked sections only to members who may use one of their commands', () => {
    expect(titles(fakeMember(USER_ID))).toEqual(['For everyone']);
    // An Officer without the loot role may still use /ping.
    expect(titles(fakeMember(USER_ID, [GUILD_A.officerRoleId]))).toEqual([
      'For everyone',
      'Loot help',
    ]);
  });

  it('hides sections whose commands do not exist', () => {
    const unknown = parseFaq('# FAQ\n## Gone\n<!-- commands: nope -->\ntext');
    expect(visibleSections(unknown, commands, fakeMember(USER_ID), GUILD_A)).toEqual([]);
  });

  it('shows raiders the raider sections of the real FAQ, but not the Officer ones', () => {
    const client = raidsClient();
    const raider = { ...fakeMember(USER_ID, [RAIDER_ROLE_ID]), client };
    const officer = { ...fakeMember(USER_ID, [GUILD_A.officerRoleId, LOOT_ROLE_ID]), client };
    const guildConfig = { ...RAID_GUILD, lootRoleId: LOOT_ROLE_ID };
    const raiderSections = visibleSections(realFaq, commands, raider, guildConfig);
    const officerSections = visibleSections(realFaq, commands, officer, guildConfig);

    expect(raiderSections.map((section) => section.id)).toEqual([
      'getting-started',
      'absences',
      'raid-sign-ups',
    ]);
    expect(officerSections).toEqual(realFaq.sections);
  });
});

describe('FAQ custom IDs', () => {
  it('round-trips and rejects other IDs', () => {
    expect(parseFaqCustomId(faqCustomId(GUILD_A.id))).toBe(GUILD_A.id);
    expect(parseFaqCustomId('faq:abc')).toBeNull();
    expect(parseFaqCustomId('loot-page:next:1')).toBeNull();
  });
});

const FAQ = parseFaq(SAMPLE);

function commandSetup({ roles = [], send } = {}) {
  const member = fakeMember(USER_ID, roles);
  const interaction = {
    client: { faq: FAQ, commands },
    user: {
      id: USER_ID,
      send: send ?? vi.fn(() => Promise.resolve({ url: 'https://discord.com/channels/@me/1/2' })),
    },
    replied: false,
    deferred: false,
    deferReply: vi.fn(function () {
      this.deferred = true;
      return Promise.resolve();
    }),
    editReply: vi.fn(() => Promise.resolve()),
  };
  const context = { guild: { id: GUILD_A.id, name: 'Guild A' }, member, guildConfig: LOOT_GUILD };
  return { interaction, context };
}

const menuOptions = (message) =>
  message.components[0].toJSON().components[0].options.map((option) => option.value);

describe('/faq', () => {
  it('registers as a server command every member can see and use', () => {
    const json = faqCommand.data.toJSON();
    expect(json).toMatchObject({ name: 'faq', contexts: [0], integration_types: [0] });
    expect(json.default_member_permissions).toBeUndefined();
    expect(faqCommand.canUse(fakeMember(USER_ID), GUILD_A)).toBe(true);
  });

  it('DMs the contents with a dropdown of the sections the member may see', async () => {
    const { interaction, context } = commandSetup();
    await faqCommand.execute(interaction, context);

    expect(interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const dm = interaction.user.send.mock.calls[0][0];
    expect(dm.content).toBe(contentsText(FAQ, [FAQ.sections[0]]));
    expect(dm.allowedMentions).toEqual({ parse: [] });
    const menu = dm.components[0].toJSON().components[0];
    expect(menu.custom_id).toBe(faqCustomId(GUILD_A.id));
    expect(menuOptions(dm)).toEqual(['for-everyone']);
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: 'I sent you the FAQ by DM: https://discord.com/channels/@me/1/2',
    });
  });

  it('shows the FAQ privately when the member does not accept DMs', async () => {
    const closed = Object.assign(new Error('Cannot send messages to this user'), {
      code: RESTJSONErrorCodes.CannotSendMessagesToThisUser,
    });
    const { interaction, context } = commandSetup({
      roles: [GUILD_A.officerRoleId],
      send: vi.fn(() => Promise.reject(closed)),
    });
    await faqCommand.execute(interaction, context);

    const reply = interaction.editReply.mock.calls[0][0];
    expect(reply.content).toBe(contentsText(FAQ, FAQ.sections, DMS_CLOSED_NOTICE));
    expect(menuOptions(reply)).toEqual(['for-everyone', 'loot-help']);
  });

  it('lets other DM errors reach the dispatcher', async () => {
    const { interaction, context } = commandSetup({
      send: vi.fn(() => Promise.reject(new Error('Discord is down'))),
    });
    await expect(faqCommand.execute(interaction, context)).rejects.toThrow('Discord is down');
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('sends a contents message without a dropdown when no section is for the member', async () => {
    const { interaction, context } = commandSetup();
    interaction.client.faq = parseFaq('# FAQ\n## Loot\n<!-- commands: loot -->\ntext');
    await faqCommand.execute(interaction, context);
    expect(interaction.user.send.mock.calls[0][0].components).toEqual([]);
  });
});

function selectSetup({
  value = 'loot-help',
  roles = [GUILD_A.officerRoleId],
  inGuild = true,
} = {}) {
  const member = fakeMember(USER_ID, roles);
  const guild = {
    id: GUILD_A.id,
    members: { cache: new Collection(inGuild ? [[USER_ID, member]] : []) },
  };
  return {
    customId: faqCustomId(GUILD_A.id),
    values: [value],
    user: { id: USER_ID },
    client: {
      faq: FAQ,
      commands,
      botConfig: makeBotConfig(LOOT_GUILD),
      guilds: { cache: new Collection([[GUILD_A.id, guild]]) },
    },
    isChatInputCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isStringSelectMenu: () => true,
    update: vi.fn(() => Promise.resolve()),
    reply: vi.fn(() => Promise.resolve()),
  };
}

describe('the FAQ dropdown', () => {
  it('shows the chosen section in place of the message', async () => {
    const interaction = selectSetup();
    await handleFaqSelect(interaction);

    const message = interaction.update.mock.calls[0][0];
    expect(message.content).toBe(sectionText(FAQ.sections[1]));
    const options = message.components[0].toJSON().components[0].options;
    expect(options.map((option) => [option.value, option.default])).toEqual([
      ['for-everyone', false],
      ['loot-help', true],
    ]);
  });

  it.each([
    ['a section removed since', { value: 'removed-section' }],
    ['a section the member may no longer see', { roles: [] }],
  ])('shows the contents with a notice for %s', async (_label, options) => {
    const interaction = selectSetup(options);
    await handleFaqSelect(interaction);

    const message = interaction.update.mock.calls[0][0];
    const sections = options.roles ? [FAQ.sections[0]] : FAQ.sections;
    expect(message.content).toBe(contentsText(FAQ, sections, SECTION_GONE_NOTICE));
  });

  it('refuses someone who is no longer a member', async () => {
    const interaction = selectSetup({ inGuild: false });
    await handleFaqSelect(interaction);
    expect(interaction.reply).toHaveBeenCalledWith({
      content: UNAVAILABLE_MESSAGE,
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.update).not.toHaveBeenCalled();
  });

  it('refuses a server that is no longer allowlisted', async () => {
    const interaction = selectSetup();
    interaction.client.botConfig = makeBotConfig();
    await handleFaqSelect(interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: UNAVAILABLE_MESSAGE }),
    );
  });

  it('is routed by interactionCreate, unlike other dropdowns', async () => {
    const faqSelect = selectSetup();
    await interactionCreate.execute(faqSelect);
    expect(faqSelect.update).toHaveBeenCalled();

    const other = selectSetup();
    other.customId = 'session:0';
    await interactionCreate.execute(other);
    expect(other.update).not.toHaveBeenCalled();
    expect(other.reply).not.toHaveBeenCalled();
  });
});
