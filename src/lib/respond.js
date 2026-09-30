// Replies to an interaction, or sends a follow-up if it was already replied to or deferred.
// Commands use this because the initial reply may already have been used, for example by a
// deferred reply or, when DM commands are enabled, by the DM server picker.
export async function respond(interaction, options) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}
