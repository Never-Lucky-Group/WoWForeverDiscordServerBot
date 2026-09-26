import { Client, GatewayIntentBits, Partials } from 'discord.js';

export function createClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // Privileged: keeps the member cache (and roles) current for DM membership checks.
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      // Privileged: message text in server channels (DM text is delivered without it).
      GatewayIntentBits.MessageContent,
      // Privileged: online status and activities.
      GatewayIntentBits.GuildPresences,
      GatewayIntentBits.DirectMessages,
    ],
    // DM channels are not cached until used; without this partial, DM messageCreate never fires.
    partials: [Partials.Channel],
  });
}
