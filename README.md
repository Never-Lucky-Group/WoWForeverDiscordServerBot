# WoWForeverDiscordServerBot

Custom WoW Forever Discord server bot, built with [discord.js](https://discord.js.org) v14 and JavaScript on Node.js 24 LTS.

The bot is used mainly in a single server but supports several. It only operates in servers on an allowlist (`config.json`) and automatically leaves any other server it is added to.

## Current behavior

- **Slash commands** (`/ping` placeholder) are limited to members with the server's configured **Officer role** and work only in servers. The command runs for the server it is used in.
  - Commands in DMs with the bot are disabled for now. Discord cannot apply server permissions in DMs, so it showed the commands to every user there. The code for them is kept (see `createOfficerCommand` in `src/lib/command.js`): with it re-enabled, a DM command runs for the allowlisted server where the user is an Officer, and if they are an Officer in several, the bot asks which server to use.
- **Direct messages** from members of any allowlisted server get a placeholder reply. DMs from anyone else are ignored.
- **New members** who join a server get that server's configured **join role**, if it has one. Bots that join are skipped. Existing members are never changed.

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

| Variable            | Required | Description                                                  |
| ------------------- | -------- | ------------------------------------------------------------ |
| `DISCORD_TOKEN`     | yes      | Bot token                                                    |
| `DISCORD_CLIENT_ID` | yes      | Application ID                                               |
| `LOG_LEVEL`         | no       | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` |
| `BOT_CONFIG_PATH`   | no       | Path to the allowlist config (default `config.json`)         |

`config.json` is the server allowlist. It is gitignored because this repository is public. See `config.example.json`.

```json
{
  "guilds": [
    {
      "name": "Production server",
      "id": "SERVER_ID",
      "officerRoleId": "ROLE_ID",
      "joinRoleId": "ROLE_ID"
    }
  ]
}
```

- `name` is only a label for you; the bot uses the server's live name.
- Get IDs by enabling _Developer Mode_ in Discord (User Settings → Advanced), then right-clicking a server or role → _Copy ID_.
- The bot refuses to start with an empty allowlist. With no servers listed, it would leave every server.
- `joinRoleId` is optional. Leave it out and new members of that server get no role. It must not be the Officer role. To assign it, the bot needs the **Manage Roles** permission, and its own role must be above the join role in the server's role list. The bot checks both at startup and logs a warning if either is missing.

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

## Deployment

Production runs the bot as a Docker container on the homelab server. GitHub is the source of truth: the server only pulls published images and never needs this repository.

```
merge to main → run CI on main → lint, format, tests → Docker build → GHCR → WUD reports the update → you click Update in WUD
```

### CI and images

`.github/workflows/ci.yml` runs only when started by hand: **Actions → CI → Run workflow**, then pick a branch. Pull requests and merges do not run it. Each run does the lint, format check and tests, then builds the Docker image.

- **Run on `main`:** publishes the image to `ghcr.io/rboothian/wowforeverdiscordserverbot`. Merging to `main` does not publish anything until you run it.
- **Run on any other branch:** tests and builds without publishing. Use it to check a branch before merging it.

Published images get three tags:

| Tag          | Example       | Use                                                       |
| ------------ | ------------- | --------------------------------------------------------- |
| `0.1.<run>`  | `0.1.42`      | Version to run in production; increases with every build  |
| `sha-<hash>` | `sha-1a2b3c4` | Finds the image built from a given commit                 |
| `main`       | `main`        | Always the newest published build; not used in production |

`MAJOR.MINOR` comes from `package.json`, and the last number is the workflow's run number. Runs on other branches use up run numbers too, so published versions can skip numbers; they always increase. The workflow logs in to GHCR with its built-in `GITHUB_TOKEN`, so no registry credentials are stored anywhere. Run it on `main` without a code change to rebuild on a patched Node base image.

After the first publish, check the package's visibility under the GitHub profile's **Packages** tab and set it to **Public** if it is not, so the server and WUD can pull it without credentials. The image contains only `src/`, `package.json` and production `node_modules` (see `.dockerignore`), never `.env` or `config.json`.

### Server setup

On the server, create a directory (for example `/opt/discord-bot`) containing:

- `compose.yml`: a copy of [`deploy/compose.yml`](deploy/compose.yml), with `image:` set to the version to run
- `.env`: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and optionally `LOG_LEVEL` (see `.env.example`). Leave `BOT_CONFIG_PATH` unset. Run `chmod 600 .env`.
- `config.json`: the server allowlist. The container runs as uid 1000, which must be able to read it.

Then, from that directory:

```bash
docker compose pull
docker compose up -d
docker compose logs -f bot
```

The bot registers its slash commands on startup (see [Slash command registration](#slash-command-registration)). To register them from the image without the running bot, use `docker compose run --rm bot node src/deploy-commands.js`.

The container has no open ports and no access to the Docker socket, runs as a non-root user with all Linux capabilities dropped, and its filesystem is read-only. Anything a future feature needs to keep must go in a volume mounted at `/app/data` (add one to `compose.yml` when needed); scratch files go in `/tmp`.

### WUD setup

[WUD](https://getwud.github.io/wud/) (What's Up Docker) watches the container, reports newer `0.1.<run>` versions and provides the **Update** button. Its Compose file on the server is separate from this repository. For the button to work, WUD needs a `dockercompose` trigger named `bot` and access to the bot's directory:

```yaml
services:
  wud:
    environment:
      # Only when the Update button is clicked, never automatically
      WUD_TRIGGER_DOCKERCOMPOSE_BOT_AUTO: 'false'
      # Only containers labelled wud.trigger.include=dockercompose.bot (the bot)
      WUD_TRIGGER_DOCKERCOMPOSE_BOT_INCLUDEBYDEFAULT: 'false'
      # Keep the previous compose.yml as compose.yml.back
      WUD_TRIGGER_DOCKERCOMPOSE_BOT_BACKUP: 'true'
    volumes:
      # Same path inside WUD as on the host, read-write, so WUD can find and edit compose.yml
      - /opt/discord-bot:/opt/discord-bot
```

The bot's `compose.yml` already has the `wud.trigger.include=dockercompose.bot` label. WUD also needs the Docker socket mounted, which it already has for watching containers. If the bot's directory is not `/opt/discord-bot`, use its path on both sides of the volume.

### Updating and rolling back

To update, open WUD and click **Update** on the bot. WUD then:

1. pulls the new image (if the pull fails, nothing else changes);
2. copies `compose.yml` to `compose.yml.back` and changes the `image:` tag in `compose.yml` to the new version;
3. stops and removes the old container, then creates and starts a new one with the new image and the same settings.

WUD copies the old container's settings rather than rereading the Compose file, so it only changes the image. After editing `.env`, or anything in `compose.yml` other than the version, apply it yourself from the bot's directory:

```bash
docker compose up -d
```

The first `docker compose up -d` after a WUD update may recreate the container once even with no changes. This is harmless.

To update without WUD, set the new version in `compose.yml`'s `image:` line, then run `docker compose pull` and `docker compose up -d`.

Either way, the new version registers its own slash commands when it starts.

To roll back after a WUD update, restore the previous file and recreate the container:

```bash
cp compose.yml.back compose.yml
docker compose up -d
```

Or set any earlier version in `compose.yml` and run `docker compose up -d`. The older version registers its own commands when it starts. Old images stay on the server until pruned.

If a new version fails to start (for example, invalid configuration), the container restarts in a loop, shown as `Restarting` in `docker compose ps`. Check `docker compose logs bot` and roll back. Nothing rolls back automatically.

## Project structure

```
.github/workflows/ci.yml    tests, then builds and publishes the Docker image
deploy/compose.yml          production Compose file template
Dockerfile                  production image
src/
  index.js                  entry point: load config, create client, load events/commands, log in
  deploy-commands.js        registers slash commands without starting the bot (manual fallback)
  config.js                 validates .env and config.json with zod
  client.js                 discord.js client (intents, partials)
  commands/<category>/*.js  slash commands, loaded automatically
  events/*.js               event listeners, loaded automatically
  handlers/                 command dispatcher, DM handler, server allowlist, join role
  lib/                      shared helpers (logger, membership checks, command builder, command registration)
  loaders/                  dynamic loaders for commands/ and events/
tests/                      Vitest tests
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

- The dispatcher has already checked the Officer role and resolved which server the command runs for before `execute` is called.
- Use `respond()` rather than `interaction.reply()`, because the first reply may already have been used (for example by a deferred reply, or by the DM server picker if DM commands are re-enabled).
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
