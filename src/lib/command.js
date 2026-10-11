import {
  ApplicationIntegrationType,
  InteractionContextType,
  SlashCommandBuilder,
} from 'discord.js';
import { isOfficer } from './membership.js';

// Every module under src/commands/<category>/ default-exports a command:
//
//   {
//     data,      // a SlashCommandBuilder, usually from createOfficerCommand()
//     execute,   // async (interaction, { guild, member, guildConfig }) => {}
//     autocomplete,  // optional: async (interaction, { guild, member, guildConfig }) => {},
//                    // for options with setAutocomplete(true); called only for members who
//                    // may use the command
//     canUse,    // optional: (member, guildConfig) => boolean, who may use the command. It
//                // replaces the Officer check, so an Officer-only command must check
//                // isOfficer() itself. Without it, only Officers may. /help hides commands the
//                // member may not use.
//     help,      // optional: longer text for /help (see below)
//   }
//
// The dispatcher has already checked canUse and resolved which allowlisted server the command
// runs for. The interaction may already have been replied to, so respond with respond() from
// lib/respond.js rather than interaction.reply().
//
// /help builds each command's options and subcommands from `data`; `help` only adds the text a
// slash command definition cannot hold. Every field is optional:
//
//   {
//     description: 'Longer description shown on the command's /help page.',
//     examples: [{ usage: '/example name:Thrall', description: 'What this example does.' }],
//     // Keyed by subcommand path without the command name, e.g. 'character' or 'imports delete'.
//     subcommands: { character: { description, examples } },
//   }

// Starts a slash command definition with the settings every Officer command shares:
// usable in servers only, installable to servers only, and hidden from non-admins by default
// (grant the Officer role in Server Settings → Integrations).
//
// Commands in DMs with the bot are disabled for now: Discord cannot apply server permissions in
// DMs, so it showed the commands to every user there, not just Officers. The dispatcher still
// has the DM code path (including the server picker); to re-enable it, add
// InteractionContextType.BotDM back to setContexts() below.
export function createOfficerCommand(name, description) {
  return createMemberCommand(name, description).setDefaultMemberPermissions(0);
}

// Starts a slash command definition that Discord shows to every member: usable in servers only
// and installable to servers only. Pair it with a `canUse` that lets members other than Officers
// run it, because the dispatcher otherwise still requires the Officer role.
export function createMemberCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setContexts(InteractionContextType.Guild)
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall);
}

// Whether `member` may use `command` in the allowlisted server configured by `guildConfig`.
export function canUseCommand(command, member, guildConfig) {
  return command.canUse ? command.canUse(member, guildConfig) : isOfficer(member, guildConfig);
}

export function isCommand(value) {
  return (
    typeof value?.execute === 'function' &&
    typeof value.data?.name === 'string' &&
    typeof value.data.toJSON === 'function' &&
    (value.canUse === undefined || typeof value.canUse === 'function')
  );
}
