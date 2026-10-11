import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { logger } from '../../lib/logger.js';
import { isoTime, toCsv } from '../csv.js';
import { sendPaged } from '../discord/pager.js';
import { sendPrivate } from '../discord/privateReply.js';
import { discordTime } from '../format.js';

export const DELETE_CONFIRM_TIMEOUT_MS = 60_000;

// One-line description of an import, e.g. for lists and confirmations.
export function describeImport(entry) {
  const raids = entry.sessions
    .map((session) => `${session.raid} ${discordTime(session.startedAt, 'd')}`)
    .join(', ');
  const replaced = entry.replacedAt ? ` · replaced ${discordTime(entry.replacedAt, 'd')}` : '';
  return (
    `**#${entry.id}** · ${raids || 'no sessions'} · ${entry.awardCount} ` +
    `item${entry.awardCount === 1 ? '' : 's'} · uploaded ${discordTime(entry.uploadedAt, 'd')} ` +
    `by <@${entry.uploadedBy}> · \`${entry.fileName.replace(/`/g, "'")}\`${replaced}`
  );
}

// /loot imports list
export async function listImports(interaction, { guild, store }) {
  const imports = store.listImports(guild.id);
  await sendPaged(interaction, {
    header: `**Gargul imports** (${imports.length}), newest first:`,
    lines: imports.map(describeImport),
    emptyText: 'Nothing has been imported yet. Use `/loot import` to add a Gargul export.',
    csv: {
      fileName: 'loot-imports.csv',
      build: () =>
        toCsv(
          [
            { header: 'import_id', value: (entry) => entry.id },
            { header: 'uploaded_at', value: (entry) => isoTime(entry.uploadedAt) },
            { header: 'uploaded_by', value: (entry) => entry.uploadedBy },
            { header: 'file_name', value: (entry) => entry.fileName },
            {
              header: 'replaced_at',
              value: (entry) => (entry.replacedAt ? isoTime(entry.replacedAt) : ''),
            },
            {
              header: 'sessions',
              value: (entry) =>
                entry.sessions
                  .map((session) => `${session.raid} ${isoTime(session.startedAt)}`)
                  .join('; '),
            },
            { header: 'items', value: (entry) => entry.awardCount },
          ],
          imports,
        ),
    },
  });
}

// /loot imports delete
export async function deleteImport(interaction, { guild, store }) {
  const importId = interaction.options.getInteger('id', true);
  const entry = store.getImport(guild.id, importId);
  if (!entry) {
    await sendPrivate(interaction, { content: `Import #${importId} was not found.` });
    return;
  }

  const ids = {
    confirm: `loot-delete:confirm:${interaction.id}`,
    cancel: `loot-delete:cancel:${interaction.id}`,
  };
  const reply = await sendPrivate(interaction, {
    content: `Delete this import and all of its awards? This cannot be undone.\n${describeImport(entry)}`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ids.confirm)
          .setLabel('Delete')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(ids.cancel)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  let button;
  try {
    button = await reply.message.awaitMessageComponent({
      componentType: ComponentType.Button,
      filter: (i) => i.user.id === interaction.user.id && Object.values(ids).includes(i.customId),
      time: DELETE_CONFIRM_TIMEOUT_MS,
    });
  } catch {
    await reply.edit({
      content: 'Nothing was deleted: the confirmation timed out.',
      components: [],
    });
    return;
  }

  if (button.customId === ids.cancel) {
    await button.update({ content: 'Nothing was deleted.', components: [] });
    return;
  }

  const removed = store.deleteImport(guild.id, importId);
  if (removed === null) {
    await button.update({ content: `Import #${importId} was already deleted.`, components: [] });
    return;
  }
  logger.info(
    { guildId: guild.id, importId, removed, userId: interaction.user.id },
    'Deleted a Gargul import',
  );
  await button.update({
    content: `Deleted import #${importId} and its ${removed} award${removed === 1 ? '' : 's'}.`,
    components: [],
  });
}
