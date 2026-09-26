// Replies to an interaction, or sends a follow-up if it was already replied to or deferred.
// Commands use this because the DM server picker may have already used the initial reply.
export async function respond(interaction, options) {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(options);
  } else {
    await interaction.reply(options);
  }
}
