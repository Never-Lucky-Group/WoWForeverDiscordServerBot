import {
  ActionRowBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { canUseCommand } from '../lib/command.js';
import { contentsText, sectionText } from './faq.js';

// The /faq messages and their section dropdown. Members may keep the DM for good, so the dropdown
// is not handled by a collector: interactionCreate passes every dropdown whose custom ID starts
// with FAQ_PREFIX to handleFaqSelect(). The custom ID carries the server the FAQ was asked for in,
// whose access rules decide which sections the member sees.

export const FAQ_PREFIX = 'faq';
export const UNAVAILABLE_MESSAGE =
  'This FAQ no longer works here. Run /faq in the server to get a new one.';
export const SECTION_GONE_NOTICE = '**That section is no longer in the FAQ.**';
export const DMS_CLOSED_NOTICE =
  "**I couldn't DM you, so here is the FAQ.** To get it by DM, allow direct messages from this " +
  "server's members in the server's Privacy Settings.";

export function faqCustomId(guildId) {
  return `${FAQ_PREFIX}:${guildId}`;
}

// The guild ID in a FAQ dropdown's custom ID, or null for any other ID.
export function parseFaqCustomId(customId) {
  return new RegExp(`^${FAQ_PREFIX}:(\\d+)$`).exec(customId)?.[1] ?? null;
}

// The sections of `faq` that `member` may see: those for everyone, and those naming a command the
// member may use, by the same rules as /help.
export function visibleSections(faq, commands, member, guildConfig) {
  return faq.sections.filter(
    (section) =>
      section.commands.length === 0 ||
      section.commands.some((name) => {
        const command = commands.get(name);
        return command !== undefined && canUseCommand(command, member, guildConfig);
      }),
  );
}

// The intro and list of `sections`, with the dropdown. `notice` goes above it.
export function contentsMessage({ faq, sections, guildId, notice }) {
  return {
    content: contentsText(faq, sections, notice),
    components: sectionMenu(sections, guildId),
    allowedMentions: { parse: [] },
  };
}

// One section, with the dropdown showing it as chosen.
export function sectionMessage({ section, sections, guildId }) {
  return {
    content: sectionText(section),
    components: sectionMenu(sections, guildId, section.id),
    allowedMentions: { parse: [] },
  };
}

function sectionMenu(sections, guildId, chosenId) {
  if (sections.length === 0) return [];
  return [
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(faqCustomId(guildId))
        .setPlaceholder('Choose a section')
        .addOptions(
          sections.map((section) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(section.title)
              .setValue(section.id)
              .setDefault(section.id === chosenId),
          ),
        ),
    ),
  ];
}

// Shows the chosen section in place of the message. A section that was removed in a later
// release, or that the member may no longer see, gets the contents back with a notice; both look
// the same, so the FAQ never reveals sections the member may not see.
export async function handleFaqSelect(interaction) {
  const guildId = parseFaqCustomId(interaction.customId);
  if (!guildId) return;
  const { client } = interaction;
  const guildConfig = client.botConfig.guilds.get(guildId);
  const member = client.guilds.cache.get(guildId)?.members.cache.get(interaction.user.id);
  if (!guildConfig || !member) {
    await interaction.reply({ content: UNAVAILABLE_MESSAGE, flags: MessageFlags.Ephemeral });
    return;
  }

  const { faq, commands } = client;
  const sections = visibleSections(faq, commands, member, guildConfig);
  const section = sections.find((candidate) => candidate.id === interaction.values[0]);
  await interaction.update(
    section
      ? sectionMessage({ section, sections, guildId })
      : contentsMessage({ faq, sections, guildId, notice: SECTION_GONE_NOTICE }),
  );
}
