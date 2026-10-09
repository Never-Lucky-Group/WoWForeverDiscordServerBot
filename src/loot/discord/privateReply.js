import { MessageFlags } from 'discord.js';

// Loot replies may list members; never ping them.
export const NO_MENTIONS = { parse: [] };

// Sends a private (ephemeral) message for a command and returns a handle to it:
//   { message, edit(options) }
// Works whether the interaction is fresh, deferred by deferPrivate(), or was already replied to
// (e.g. by the DM server picker, when DM commands are enabled).
export async function sendPrivate(interaction, options) {
  const payload = { allowedMentions: NO_MENTIONS, ...options };

  if (interaction.deferred && !interaction.replied) {
    const message = await interaction.editReply(payload);
    return handle(interaction, message, '@original');
  }
  if (interaction.replied) {
    const message = await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    return handle(interaction, message, message.id);
  }
  const response = await interaction.reply({
    ...payload,
    flags: MessageFlags.Ephemeral,
    withResponse: true,
  });
  const message = response.resource?.message;
  if (!message) throw new Error('Discord did not return the reply message');
  return handle(interaction, message, '@original');
}

// Acknowledges the command privately so slow work (e.g. downloading a file) cannot run past
// Discord's 3-second reply deadline. Does nothing if the interaction was already answered.
export async function deferPrivate(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

function handle(interaction, message, target) {
  return {
    message,
    edit: (options) =>
      interaction.editReply({ allowedMentions: NO_MENTIONS, ...options, message: target }),
  };
}
