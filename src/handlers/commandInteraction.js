import {
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { logger } from '../lib/logger.js';
import { findOfficerMemberships, isOfficer } from '../lib/membership.js';
import { respond } from '../lib/respond.js';

export const NO_PERMISSION_MESSAGE = "You don't have permission to use this command.";
export const COMMAND_ERROR_MESSAGE = 'There was an error while running this command.';
export const PICKER_TIMEOUT_MESSAGE =
  'No server was selected in time, so the command was cancelled.';
export const PICKER_TIMEOUT_MS = 60_000;

// Central slash command dispatcher: looks up the command, resolves which allowlisted server it
// runs for (asking in DMs when the user is an Officer in several; DM commands are currently
// disabled), enforces the Officer role, then runs it. Any error is logged and reported to the user.
export async function handleChatInputCommand(interaction) {
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn({ commandName: interaction.commandName }, 'Received an unknown command');
    await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const context = await resolveCommandContext(interaction);
    if (!context) return;
    await command.execute(interaction, context);
  } catch (error) {
    logger.error(
      { err: error, commandName: interaction.commandName, userId: interaction.user.id },
      'Command failed',
    );
    try {
      await respond(interaction, { content: COMMAND_ERROR_MESSAGE, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      logger.error({ err: replyError }, 'Failed to tell the user that the command failed');
    }
  }
}

// Returns { guild, member, guildConfig } to run the command in, or null if the user was denied
// or cancelled.
//
// Commands in DMs are disabled for now (see createOfficerCommand in lib/command.js), so Discord
// does not send DM command interactions and the DM path below, including promptForGuild, is not
// reached. It is kept so the feature can be re-enabled by changing only the command contexts.
async function resolveCommandContext(interaction) {
  if (interaction.inGuild()) {
    const guildConfig = interaction.client.botConfig.guilds.get(interaction.guildId);
    if (
      !guildConfig ||
      !interaction.inCachedGuild() ||
      !isOfficer(interaction.member, guildConfig)
    ) {
      await deny(interaction);
      return null;
    }
    return { guild: interaction.guild, member: interaction.member, guildConfig };
  }

  const memberships = findOfficerMemberships(interaction.client, interaction.user.id);
  if (memberships.length === 0) {
    await deny(interaction);
    return null;
  }
  if (memberships.length === 1) return memberships[0];
  return promptForGuild(interaction, memberships);
}

// Asks a DM user which server to run the command in. Not reached while DM commands are disabled.
async function promptForGuild(interaction, memberships) {
  const customId = `guild-picker:${interaction.id}`;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a server')
    .addOptions(
      memberships.map(({ guild }) =>
        new StringSelectMenuOptionBuilder().setLabel(guild.name).setValue(guild.id),
      ),
    );

  const response = await interaction.reply({
    content: `Which server should \`/${interaction.commandName}\` run in?`,
    components: [new ActionRowBuilder().addComponents(menu)],
    withResponse: true,
  });
  const pickerMessage = response.resource?.message;
  if (!pickerMessage) throw new Error('Discord did not return the server picker message');

  let selection;
  try {
    selection = await pickerMessage.awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: (i) => i.customId === customId && i.user.id === interaction.user.id,
      time: PICKER_TIMEOUT_MS,
    });
  } catch {
    await interaction.editReply({ content: PICKER_TIMEOUT_MESSAGE, components: [] });
    return null;
  }

  // Re-check against current state: roles or membership may have changed while the picker was open.
  const chosen = findOfficerMemberships(interaction.client, interaction.user.id).find(
    ({ guild }) => guild.id === selection.values[0],
  );
  if (!chosen) {
    logDenied(interaction);
    await selection.update({ content: NO_PERMISSION_MESSAGE, components: [] });
    return null;
  }

  await selection.update({
    content: `Running \`/${interaction.commandName}\` in **${chosen.guild.name}**.`,
    components: [],
  });
  return chosen;
}

async function deny(interaction) {
  logDenied(interaction);
  await interaction.reply({ content: NO_PERMISSION_MESSAGE, flags: MessageFlags.Ephemeral });
}

function logDenied(interaction) {
  logger.info(
    {
      commandName: interaction.commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId,
    },
    'Denied command: user is not an Officer',
  );
}
