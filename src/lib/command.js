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
// command runs for. The interaction may already have been replied to (e.g. by the DM server
// picker), so respond with respond() from lib/respond.js rather than interaction.reply().

// Starts a slash command definition with the settings every Officer command shares:
// usable in servers and in DMs with the bot, installable to servers only, and hidden from
// non-admins by default (grant the Officer role in Server Settings → Integrations).
export function createOfficerCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM)
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
