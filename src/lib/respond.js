// Replies to an interaction: fills in a deferred reply, sends a follow-up if it was already
// replied to, or replies normally. Commands use this because the initial reply may already have
// been used, for example by a deferred reply or, when DM commands are enabled, by the DM server
// picker.
export async function respond(interaction, options) {
  if (interaction.replied) {
    await interaction.followUp(options);
  } else if (interaction.deferred) {
    // Replaces the "thinking…" placeholder. A deferred reply keeps the visibility it was
    // deferred with, so flags such as Ephemeral are dropped.
    const editOptions = { ...options };
    delete editOptions.flags;
    await interaction.editReply(editOptions);
  } else {
    await interaction.reply(options);
  }
}
