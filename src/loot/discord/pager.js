import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  MessageFlags,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { sendPrivate } from './privateReply.js';

// How long the page and download buttons keep working.
export const PAGER_TIMEOUT_MS = 10 * 60_000;
export const PAGE_SIZE = 15;
// Discord allows 2000 characters per message; leave room for the header and page footer.
const PAGE_CHARACTERS = 1500;

// Splits `lines` into pages of at most PAGE_SIZE lines and PAGE_CHARACTERS characters.
export function paginate(lines) {
  const pages = [];
  let page = [];
  let length = 0;
  for (const line of lines) {
    const text = line.length > PAGE_CHARACTERS ? `${line.slice(0, PAGE_CHARACTERS - 1)}…` : line;
    if (page.length > 0 && (page.length >= PAGE_SIZE || length + text.length > PAGE_CHARACTERS)) {
      pages.push(page);
      page = [];
      length = 0;
    }
    page.push(text);
    length += text.length + 1;
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

// Sends `lines` privately under `header`, with Previous/Next buttons when there is more than one
// page and a Download CSV button that sends `csv.build()` as `csv.fileName`.
export async function sendPaged(interaction, { header, lines, emptyText, csv }) {
  if (lines.length === 0) {
    await sendPrivate(interaction, { content: `${header}\n${emptyText}` });
    return;
  }

  const pages = paginate(lines);
  const ids = {
    previous: `loot-page:previous:${interaction.id}`,
    next: `loot-page:next:${interaction.id}`,
    csv: `loot-page:csv:${interaction.id}`,
  };
  let pageIndex = 0;

  const render = () => {
    const footer = pages.length > 1 ? `\n-# Page ${pageIndex + 1} of ${pages.length}` : '';
    const buttons = [];
    if (pages.length > 1) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(ids.previous)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === 0),
        new ButtonBuilder()
          .setCustomId(ids.next)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageIndex === pages.length - 1),
      );
    }
    buttons.push(
      new ButtonBuilder()
        .setCustomId(ids.csv)
        .setLabel('Download CSV')
        .setStyle(ButtonStyle.Primary),
    );
    return {
      content: `${header}\n${pages[pageIndex].join('\n')}${footer}`,
      components: [new ActionRowBuilder().addComponents(buttons)],
    };
  };

  const reply = await sendPrivate(interaction, render());
  const collector = reply.message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (button) => button.user.id === interaction.user.id,
    time: PAGER_TIMEOUT_MS,
  });

  collector.on('collect', async (button) => {
    try {
      if (button.customId === ids.csv) {
        await button.reply({
          files: [new AttachmentBuilder(Buffer.from(csv.build(), 'utf8'), { name: csv.fileName })],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (button.customId === ids.previous) pageIndex = Math.max(0, pageIndex - 1);
      if (button.customId === ids.next) pageIndex = Math.min(pages.length - 1, pageIndex + 1);
      await button.update(render());
    } catch (error) {
      logger.error({ err: error }, 'Failed to handle a loot page button');
    }
  });

  collector.on('end', () => {
    reply.edit({ components: [] }).catch((error) => {
      logger.debug({ err: error }, 'Could not remove expired loot page buttons');
    });
  });
}
