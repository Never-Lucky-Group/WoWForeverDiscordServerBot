import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { logger } from '../../lib/logger.js';
import { deferPrivate, sendPrivate } from '../discord/privateReply.js';
import { discrepancyLine, joinWithinLimit, sessionSpan } from '../format.js';
import { GargulExportError, parseGargulExport } from '../gargulExport.js';
import { MAX_SESSIONS, planImport } from '../importPlan.js';

// Gargul exports are plain text; a season of awards is well under 1 MB.
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Gives up on a stalled download well before Discord's 15-minute interaction limit.
export const DOWNLOAD_TIMEOUT_MS = 30_000;
// How long the officer has to label the sessions and press Import.
export const LABEL_TIMEOUT_MS = 5 * 60_000;
const MESSAGE_LIMIT = 2000;

const DISCREPANCY_HINT =
  'Nothing stored was changed. To fix an import, use `/loot imports replace` with a corrected ' +
  'export, or `/loot imports delete`.';

// /loot import and /loot imports replace. `replacingImportId` is set for replace.
export async function importExport(interaction, { guild, guildConfig, store }, replacingImportId) {
  const raids = guildConfig.raids ?? [];
  if (raids.length === 0) {
    await sendPrivate(interaction, {
      content:
        'No raids are configured for this server, so loot cannot be labelled. Add a `raids` ' +
        'list for this server in config.json and restart the bot.',
    });
    return;
  }

  const attachment = interaction.options.getAttachment('file', true);
  if (attachment.size > MAX_FILE_BYTES) {
    await sendPrivate(interaction, {
      content: `That file is too large (limit ${MAX_FILE_BYTES / 1024 / 1024} MB).`,
    });
    return;
  }

  if (replacingImportId !== undefined && !store.getImport(guild.id, replacingImportId)) {
    await sendPrivate(interaction, { content: `Import #${replacingImportId} was not found.` });
    return;
  }

  await deferPrivate(interaction);

  let awards;
  try {
    awards = parseGargulExport(await download(attachment.url));
  } catch (error) {
    if (!(error instanceof GargulExportError)) throw error;
    await sendPrivate(interaction, { content: error.message });
    return;
  }

  const plan = planImport({ store, guildId: guild.id, awards, raids, replacingImportId });

  if (plan.newCount === 0) {
    const reason =
      replacingImportId === undefined
        ? `Nothing to import: all ${plan.storedCount} awards in this file are already stored.`
        : `Nothing was replaced: every award in this file belongs to another import. To remove ` +
          `import #${replacingImportId}, use \`/loot imports delete\`.`;
    await sendPrivate(interaction, { content: withDiscrepancies(reason, plan.discrepancies) });
    return;
  }

  if (plan.newSessions.length > MAX_SESSIONS) {
    await sendPrivate(interaction, {
      content:
        `This file has ${plan.newSessions.length} raid sessions with new awards; one upload can ` +
        `hold at most ${MAX_SESSIONS}. In Gargul's export window, select fewer dates and ` +
        `export again.`,
    });
    return;
  }

  const ids = {
    session: (index) => `loot-import:session:${index}:${interaction.id}`,
    confirm: `loot-import:confirm:${interaction.id}`,
    cancel: `loot-import:cancel:${interaction.id}`,
  };
  const choices = plan.newSessions.map((session) => session.suggestedRaid);

  const reply = await sendPrivate(interaction, {
    content: previewText(plan, replacingImportId),
    components: [
      ...plan.newSessions.map((session, index) =>
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(ids.session(index))
            .setPlaceholder(`Session ${index + 1}: choose the raid`)
            .addOptions(
              raids.map((raid) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(raid)
                  .setValue(raid)
                  .setDefault(raid === session.suggestedRaid),
              ),
            ),
        ),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(ids.confirm)
          .setLabel(replacingImportId === undefined ? 'Import' : `Replace #${replacingImportId}`)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(ids.cancel)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });

  const collector = reply.message.createMessageComponentCollector({
    filter: (component) => component.user.id === interaction.user.id,
    time: LABEL_TIMEOUT_MS,
  });

  let saved = false;
  collector.on('collect', async (component) => {
    try {
      if (component.isStringSelectMenu()) {
        const index = plan.newSessions.findIndex((_, i) => component.customId === ids.session(i));
        if (index !== -1) choices[index] = component.values[0];
        await component.deferUpdate();
        return;
      }
      if (component.customId === ids.cancel) {
        collector.stop('cancelled');
        await component.update({
          content: 'Import cancelled. Nothing was stored.',
          components: [],
        });
        return;
      }
      if (component.customId !== ids.confirm) return;

      const missing = choices.findIndex((raid) => !raid);
      if (missing !== -1) {
        await component.reply({
          content: `Choose a raid for session ${missing + 1} first.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      collector.stop('confirmed');
      const sessions = plan.newSessions.map((session, index) => ({
        ...session,
        raid: choices[index],
      }));
      const content = save({ interaction, guild, store, plan, sessions, replacingImportId });
      saved = true;
      await component.update({ content, components: [] });
    } catch (error) {
      logger.error({ err: error }, 'Failed to handle a loot import component');
      collector.stop('error');
      // save() runs in a transaction, so a failure inside it stores nothing.
      const content = saved
        ? 'The import was stored, but the result could not be shown. Check `/loot imports list`.'
        : 'Something went wrong; nothing was imported.';
      await reply.edit({ content, components: [] }).catch(() => {});
    }
  });

  collector.on('end', (_collected, reason) => {
    if (reason !== 'time') return;
    reply
      .edit({
        content: 'No raid was confirmed in time, so nothing was imported. Upload the file again.',
        components: [],
      })
      .catch((error) => logger.debug({ err: error }, 'Could not expire the import prompt'));
  });
}

// Stores the labelled sessions and returns the text describing the result.
function save({ interaction, guild, store, plan, sessions, replacingImportId }) {
  const common = {
    guildId: guild.id,
    uploadedBy: interaction.user.id,
    fileName: interaction.options.getAttachment('file', true).name,
    sessions,
  };
  const raidNames = [...new Set(sessions.map((session) => session.raid))].join(', ');

  if (replacingImportId === undefined) {
    const result = store.createImport(common);
    if (result.importId === null) {
      return withDiscrepancies(
        'Nothing was imported: another upload stored these awards in the meantime.',
        plan.discrepancies,
      );
    }
    logger.info(
      {
        guildId: guild.id,
        importId: result.importId,
        ...counts(result),
        userId: common.uploadedBy,
      },
      'Imported a Gargul export',
    );
    return withDiscrepancies(
      `Imported **#${result.importId}** (${raidNames}): **${result.inserted}** new ` +
        `award${result.inserted === 1 ? '' : 's'}` +
        skippedText(plan.storedCount + result.skipped),
      plan.discrepancies,
    );
  }

  const result = store.replaceImport({ ...common, importId: replacingImportId });
  if (result === null) {
    return withDiscrepancies(
      `Nothing was replaced: import #${replacingImportId} was deleted, or every award in the ` +
        'file is now stored by another import.',
      plan.discrepancies,
    );
  }
  logger.info(
    {
      guildId: guild.id,
      importId: replacingImportId,
      ...counts(result),
      userId: common.uploadedBy,
    },
    'Replaced a Gargul import',
  );
  return withDiscrepancies(
    `Replaced **#${replacingImportId}** (${raidNames}): removed ${result.removed}, stored ` +
      `**${result.inserted}** award${result.inserted === 1 ? '' : 's'}` +
      skippedText(plan.storedCount + result.skipped),
    plan.discrepancies,
  );
}

function counts({ inserted, skipped, removed }) {
  return { inserted, skipped, removed };
}

function skippedText(skipped) {
  return skipped > 0 ? `; skipped ${skipped} already stored by other imports.` : '.';
}

function previewText(plan, replacingImportId) {
  const lines = [
    replacingImportId === undefined
      ? `Found **${plan.newCount}** new award${plan.newCount === 1 ? '' : 's'} in ` +
        `**${plan.newSessions.length}** raid session${plan.newSessions.length === 1 ? '' : 's'}` +
        (plan.storedCount > 0 ? ` (${plan.storedCount} already stored will be skipped).` : '.')
      : `Replace import **#${replacingImportId}** with **${plan.newCount}** ` +
        `award${plan.newCount === 1 ? '' : 's'} in **${plan.newSessions.length}** raid ` +
        `session${plan.newSessions.length === 1 ? '' : 's'}` +
        (plan.storedCount > 0
          ? ` (${plan.storedCount} stored by other imports will be skipped).`
          : '.'),
    ...plan.newSessions.map(
      (session, index) =>
        `**Session ${index + 1}:** ${sessionSpan(session)} · ${session.awards.length} ` +
        `award${session.awards.length === 1 ? '' : 's'}` +
        (session.suggestedRaid ? ` · suggested: ${session.suggestedRaid}` : ''),
    ),
    'Choose the raid for each session, then confirm.',
  ];
  return withDiscrepancies(lines.join('\n'), plan.discrepancies);
}

// Appends the discrepancy list (if any) to `text`, keeping within Discord's message limit.
function withDiscrepancies(text, discrepancies) {
  if (discrepancies.length === 0) return text;
  const header =
    `${text}\n\n⚠️ **${discrepancies.length} already-stored ` +
    `award${discrepancies.length === 1 ? '' : 's'} differ from this file.** ${DISCREPANCY_HINT}`;
  return joinWithinLimit(header, discrepancies.map(discrepancyLine), MESSAGE_LIMIT);
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Downloading the attachment failed with HTTP ${response.status}`);
  }
  return response.text();
}
