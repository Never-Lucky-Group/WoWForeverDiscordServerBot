# Development

How to run the bot locally, configure it, and change its code. For using the bot, see the [FAQ](faq.md); for running it in production, see [Deployment](deployment.md).

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm

## Local setup

For local development, run your own test bot: a separate Discord application with its own token, added to a test server. Never run the code locally with the production bot's token (see [Test bots and production](#test-bots-and-production)).

### Create a test bot

1. Turn on two-factor authentication for your Discord account (User Settings → My Account). In servers that require 2FA for moderator actions, Discord blocks permissions such as **Manage Roles** for bots whose owner has no 2FA, so the join role would not be assigned.
2. In the [Discord Developer Portal](https://discord.com/developers/applications), click **New Application**.
3. On the **Installation** tab, set **Install Link** to **None** and turn off **User Install**.
4. On the **Bot** tab:
   - Turn off **Public Bot**, so only you can add the bot to servers. This only works after the install link is set to **None**.
   - Turn on all three **Privileged Gateway Intents**: **Presence Intent**, **Server Members Intent** and **Message Content Intent**. The bot fails to log in if any of them is off.
5. On the **General Information** tab, copy the **Application ID**.
6. Open this link with your Application ID in place of `APPLICATION_ID`, then pick your test server:

   ```
   https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot+applications.commands&permissions=8542101273308401
   ```

   It requests the same permissions as the production bot, so a missing permission shows up in testing rather than after deploying.

7. In the test server:
   - Under **Server Settings → Roles**, drag the bot's role above the join role, so the bot can assign it.
   - Under **Server Settings → Integrations →** your bot **→ Roles & Members**, turn off **@everyone** and add the **Officer** role, so only Officers see the bot's commands.

### Run it

```bash
npm install
cp .env.example .env                  # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
cp config.example.json config.json    # list only your test server
npm run dev                           # start with auto-restart and readable logs; registers slash commands
```

- In `.env`, set `DISCORD_CLIENT_ID` to the Application ID. For `DISCORD_TOKEN`, go to the Developer Portal's **Bot** tab, click **Reset Token** and copy the token. Discord shows it only once; if you lose it, reset it again.
- In `config.json`, list only your test server, with its Officer role and join role (see [Configuration](#configuration)).

On startup, the logs should show the bot logging in, `Cached guild members` for the test server and `Registered global application commands`, with no warnings. Reload Discord (Ctrl+R) if the commands do not appear.

### Configuration

`.env` holds secrets and runtime settings. See `.env.example`.

| Variable               | Required | Description                                                                                                                                    |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DISCORD_TOKEN`        | yes      | Bot token                                                                                                                                      |
| `DISCORD_CLIENT_ID`    | yes      | Application ID                                                                                                                                 |
| `LOG_LEVEL`            | no       | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace`                                                                                   |
| `BOT_CONFIG_PATH`      | no       | Path to the allowlist config (default `config.json`)                                                                                           |
| `LOOT_DB_PATH`         | no       | Loot database file (default `data/loot.sqlite`)                                                                                                |
| `RAIDS_DB_PATH`        | no       | Raids database file: raid setup, absences and reminders (default `data/raids.sqlite`)                                                          |
| `RAID_HELPER_API_KEYS` | no       | Each server's Raid-Helper API key, which turns raid sign-ups on there (see [Setting up raid sign-ups](deployment.md#setting-up-raid-sign-ups)) |
| `BOT_VERSION`          | no       | Release version shown in the bot's description (default `dev`). The Docker image sets it; leave it unset in `.env`                             |

`config.json` is the server allowlist. It is gitignored because this repository is public. See `config.example.json`.

```json
{
  "guilds": [
    {
      "name": "Production server",
      "id": "SERVER_ID",
      "officerRoleId": "ROLE_ID",
      "joinRoleId": "ROLE_ID",
      "lootRoleId": "ROLE_ID",
      "raids": ["Molten Core", "Onyxia"],
      "raidReset": { "weekday": "tuesday", "time": "15:00", "timeZone": "UTC" }
    }
  ]
}
```

- `name` is only a label for you; the bot uses the server's live name.
- Get IDs by enabling _Developer Mode_ in Discord (User Settings → Advanced), then right-clicking a server or role → _Copy ID_.
- The bot refuses to start with an empty allowlist. With no servers listed, it would leave every server.
- `joinRoleId` is optional. Leave it out and new members of that server get no role. It must not be the Officer role. To assign it, the bot needs the **Manage Roles** permission, and its own role must be above the join role in the server's role list. The bot checks both at startup and logs a warning if either is missing.
- `lootRoleId` is optional. The `/loot` commands need this role **and** the Officer role. Leave it out and `/loot` is disabled in that server. It may be the Officer role itself, but not the join role.
- The loot and raids data are kept in SQLite databases (Node's built-in `node:sqlite`) at `LOOT_DB_PATH` and `RAIDS_DB_PATH`, per server.
- `raids` is optional: up to 25 unique raid names (up to 100 characters each) offered when labelling an import. Importing needs at least one. Renaming a raid here does not rename it in loot already imported.
- `raidReset` is optional: when the weekly raid lockout resets, as a lowercase `weekday`, a 24-hour `time` and an [IANA time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones). It defaults to Tuesday 15:00 UTC. The `weeks` filter counts back from it, and `from`/`to` dates are read in its time zone.
- Raid sign-ups are not set up in `config.json` but in Discord with `/raidsetup`; see [Setting up raids](faq.md#setting-up-raids) in the FAQ. A leftover `raidHelper` block stops the bot at startup with a message to remove it.

### Test bots and production

Each Discord application is a separate bot with its own token and its own list of slash commands. A test bot only receives events from the servers it has been added to, and registering its commands never changes the production bot's commands, so testing locally does not affect production.

Keep the production token on the production server only. Two running copies of the bot with the same token both receive every event, so both would answer DMs and race each other on commands.

## Scripts

| Script                    | Description                                                               |
| ------------------------- | ------------------------------------------------------------------------- |
| `npm start`               | Run the bot (JSON logs)                                                   |
| `npm run dev`             | Run with auto-restart on file changes and pretty logs                     |
| `npm run deploy-commands` | Register slash commands without starting the bot (see below)              |
| `npm run lint`            | ESLint                                                                    |
| `npm run format`          | Format all files with Prettier (`format:check` to verify without writing) |
| `npm test`                | Run the Vitest suite once (`test:watch` to re-run on changes)             |

Both `start` and `dev` load `.env` if it exists; otherwise they read variables from the environment.

### Slash command registration

The bot registers its slash commands with Discord every time it starts, in the background after logging in, so Discord always lists the commands of the version that is running. This covers first setup, updates, rollbacks and local `npm run dev`. Commands are registered globally; because the bot leaves servers that are not allowlisted, they only show up in allowlisted servers.

Registration replaces the whole command list, so removed commands disappear from Discord too. Re-sending an unchanged list does not count toward Discord's limit of 200 command creates per day; only command names that are new to Discord do. If registration fails, the bot logs an error and keeps running with the list Discord already has, and the next start tries again.

`npm run deploy-commands` registers the commands without starting the bot. It is only a manual fallback.

If a new or changed command does not appear, reload Discord (Ctrl+R).

### Version in the bot's description

Every time it starts, the bot writes the version it is running as the last line of its description (its **About Me**), after a blank line: `Version: 0.4.0`. The deploy workflow passes the release tag's version to the image as `BOT_VERSION`; a bot started from a checkout shows `Version: dev`. Only that line is managed: write the rest of the description in the Developer Portal (**General Information → Description**) and the next start keeps it. The edit is only sent when the line changes.

Discord allows 400 characters. If the text plus the version line would be longer, the bot logs a warning and leaves the description unchanged; shorten the text in the portal and restart. If the edit fails, the bot logs an error and keeps running, and the next start tries again.

## Commands in DMs

Commands in DMs with the bot are disabled for now. Discord cannot apply server permissions in DMs, so it showed the commands to every user there. The code for them is kept (see `createOfficerCommand` in `src/lib/command.js`): with it re-enabled, a DM command runs for the allowlisted server where the user may use it, and if there are several, the bot asks which server to use.

## Project structure

```
.github/workflows/test.yml  lint, format check and unit tests on every pull request
.github/workflows/deploy.yml tests a release tag, then builds and publishes its Docker image
deploy/compose.yml          production Compose file template
docs/                       FAQ (also sent by /faq), development and deployment guides
Dockerfile                  production image
src/
  index.js                  entry point: load config, create client, load events/commands, log in
  deploy-commands.js        registers slash commands without starting the bot (manual fallback)
  config.js                 validates .env and config.json with zod
  faq/                      reads docs/faq.md and sends it for /faq, with its section dropdown
  client.js                 discord.js client (intents, partials)
  commands/<category>/*.js  slash commands, loaded automatically
  events/*.js               event listeners, loaded automatically
  handlers/                 command dispatcher, DM handler, server allowlist, join role
  lib/                      shared helpers (logger, membership checks, command builders, command registration, bot description, /help pages, time zones, SQLite)
  loaders/                  dynamic loaders for commands/ and events/
  loot/                     Gargul loot tracking: export parser, database, queries and /loot handlers
  raids/                    Raid-Helper sign-ups: API client, database, setup rules, background loop, member DMs, /raid, /raidsetup and /absence handlers
tests/                      Vitest tests
tests/fixtures/gargul/      generated sample Gargul JSON export
```

Plain JavaScript with ES modules (`import`/`export`); there is no build step. Imports between source files include the `.js` extension.

### Adding a slash command

Create `src/commands/<category>/<name>.js`:

```js
import { MessageFlags } from 'discord.js';
import { createOfficerCommand } from '../../lib/command.js';
import { respond } from '../../lib/respond.js';

export default {
  data: createOfficerCommand('example', 'What the command does.'),
  async execute(interaction, { guild, member, guildConfig }) {
    await respond(interaction, {
      content: `Hello from ${guild.name}!`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
```

- The dispatcher has already checked that the member may use the command and resolved which server it runs for before `execute` is called.
- Only Officers may use a command by default. To change that, export `canUse(member, guildConfig)` returning whether the member may use it (`/loot` also requires the loot role, `/help` allows everyone). It replaces the Officer check, so a command that should stay Officer-only must call `isOfficer()` from `src/lib/membership.js` itself. Build a command that members other than Officers can use with `createMemberCommand` instead of `createOfficerCommand`, which hides the command from non-admins in Discord. `/help` lists only the commands a member may use.
- `/help` builds each command's usage, options and subcommands from `data`. To add a longer description and examples, export `help` (the format is described in `src/lib/command.js`; see `src/commands/loot/loot.js` for subcommands). Without it, `/help` uses the command's short description.
- Use `respond()` rather than `interaction.reply()`, because the first reply may already have been used (for example by a deferred reply, or by the DM server picker if DM commands are re-enabled).
- For options with `setAutocomplete(true)`, also export `async autocomplete(interaction, { guild, member, guildConfig })` and answer with `interaction.respond(choices)`. The dispatcher only calls it for members who may use the command.
- If members should know about it, add questions to [`faq.md`](faq.md). A section that starts with `<!-- commands: name -->` is shown in `/faq` only to members who may use one of the named commands. Each section must fit in one Discord message, and the FAQ may use only the markdown that GitHub and Discord both show; the tests check both.
- The bot registers it with Discord the next time it starts (`npm run dev` restarts on save). Reload Discord (Ctrl+R) if it does not appear.

### Adding an event listener

Create `src/events/<name>.js`:

```js
import { Events } from 'discord.js';

export default {
  name: Events.GuildMemberAdd,
  // once: true, // to run only the first time the event fires
  async execute(member) {
    // ...
  },
};
```

Errors thrown by any event handler are logged, not crashed on.
