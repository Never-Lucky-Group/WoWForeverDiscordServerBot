import {
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { canUseCommand } from '../lib/command.js';
import { logger } from '../lib/logger.js';
import { findAllowlistedMemberships } from '../lib/membership.js';
import { respond } from '../lib/respond.js';

export const NO_PERMISSION_MESSAGE = "You don't have permission to use this command.";
export const COMMAND_ERROR_MESSAGE = 'There was an error while running this command.';
export const PICKER_TIMEOUT_MESSAGE =
  'No server was selected in time, so the command was cancelled.';
export const PICKER_TIMEOUT_MS = 60_000;

// Central slash command dispatcher: looks up the command, resolves which allowlisted server it
// runs for (asking in DMs when the user may use it in several; DM commands are currently
// disabled), checks that the user may use it (the Officer role unless the command's canUse says
// otherwise), then runs it. Any error is logged and reported to the user.
export async function handleChatInputCommand(interaction) {
  const command = interaction.client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn({ commandName: interaction.commandName }, 'Received an unknown command');
    await interaction.reply({ content: 'Unknown command.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    const context = await resolveCommandContext(interaction, command);
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

// Answers an autocomplete request by calling the command's autocomplete(interaction, context).
// Only members of an allowlisted server who may use the command get suggestions; everyone else
// gets an empty list, so stored data never leaks to other members.
export async function handleAutocomplete(interaction) {
  const command = interaction.client.commands.get(interaction.commandName);
  const guildConfig = interaction.inGuild()
    ? interaction.client.botConfig.guilds.get(interaction.guildId)
    : undefined;

  try {
    if (
      typeof command?.autocomplete !== 'function' ||
      !guildConfig ||
      !interaction.inCachedGuild() ||
      !canUseCommand(command, interaction.member, guildConfig)
    ) {
      await interaction.respond([]);
      return;
    }
    await command.autocomplete(interaction, {
      guild: interaction.guild,
      member: interaction.member,
      guildConfig,
    });
  } catch (error) {
    logger.error(
      { err: error, commandName: interaction.commandName, userId: interaction.user.id },
      'Autocomplete failed',
    );
    if (!interaction.responded) {
      await interaction.respond([]).catch(() => {});
    }
  }
}

// Returns { guild, member, guildConfig } to run the command in, or null if the user was denied
// or cancelled.
//
// Commands in DMs are disabled for now (see createOfficerCommand in lib/command.js), so Discord
// does not send DM command interactions and the DM path below, including promptForGuild, is not
// reached. It is kept so the feature can be re-enabled by changing only the command contexts.
async function resolveCommandContext(interaction, command) {
  if (interaction.inGuild()) {
    const guildConfig = interaction.client.botConfig.guilds.get(interaction.guildId);
    if (
      !guildConfig ||
      !interaction.inCachedGuild() ||
      !canUseCommand(command, interaction.member, guildConfig)
    ) {
      await deny(interaction);
      return null;
    }
    return { guild: interaction.guild, member: interaction.member, guildConfig };
  }

  const memberships = findUsableMemberships(interaction, command);
  if (memberships.length === 0) {
    await deny(interaction);
    return null;
  }
  if (memberships.length === 1) return memberships[0];
  return promptForGuild(interaction, command, memberships);
}

// Allowlisted servers where the user is a member and may use the command.
function findUsableMemberships(interaction, command) {
  return findAllowlistedMemberships(interaction.client, interaction.user.id).filter(
    ({ member, guildConfig }) => canUseCommand(command, member, guildConfig),
  );
}

// Asks a DM user which server to run the command in. Not reached while DM commands are disabled.
async function promptForGuild(interaction, command, memberships) {
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
  const chosen = findUsableMemberships(interaction, command).find(
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
    'Denied command: user may not use it',
  );
}
