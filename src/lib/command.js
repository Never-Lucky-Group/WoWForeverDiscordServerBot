import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';

// Every module under src/commands/<category>/ default-exports a command:
//
//   {
//     data,      // a SlashCommandBuilder, usually from createOfficerCommand()
//     execute,   // async (interaction, { guild, member, guildConfig }) => {}
//   }
//
// The dispatcher has already checked the Officer role and resolved which allowlisted server the
// command runs for. The interaction may already have been replied to, so respond with respond()
// from lib/respond.js rather than interaction.reply().

// Starts a slash command definition with the settings every Officer command shares:
// usable in servers only, installable to servers only, and hidden from non-admins by default
// (grant the Officer role in Server Settings → Integrations).
//
// Commands in DMs with the bot are disabled for now: Discord cannot apply server permissions in
// DMs, so it showed the commands to every user there, not just Officers. The dispatcher still
// has the DM code path (including the server picker); to re-enable it, add
// InteractionContextType.BotDM back to setContexts() below.
export function createOfficerCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setDefaultMemberPermissions(0);
}

export function isCommand(value) {
  return (
    typeof value?.execute === 'function' &&
    typeof value.data?.name === 'string' &&
    typeof value.data.toJSON === 'function'
  );
}
