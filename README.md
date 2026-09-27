# WoWForeverDiscordServerBot

Custom WoW Forever Discord server bot, built with [discord.js](https://discord.js.org) v14 and JavaScript on Node.js 24 LTS.

The bot is used mainly in a single server but supports several. It only operates in servers on an allowlist (`config.json`) and automatically leaves any other server it is added to.

## Current behavior

- **Slash commands** (`/ping` placeholder) are limited to members with the server's configured **Officer role**. They work in servers and in DMs with the bot.
  - In a server, the command runs for that server.
  - In a DM, it runs for the allowlisted server where the user is an Officer. If they are an Officer in several, the bot asks which server to use.
- **Direct messages** from members of any allowlisted server get a placeholder reply. DMs from anyone else are ignored.
- **Messages in server channels** are ignored for now.

## Requirements

- Node.js 24 LTS (see `.nvmrc`)
- npm

## Local setup

```bash
npm install
cp .env.example .env                  # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
cp config.example.json config.json    # fill in the allowlisted servers
npm run deploy-commands               # register slash commands with Discord
npm run dev                           # start with auto-restart and readable logs
```

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
  "guilds": [{ "name": "Production server", "id": "SERVER_ID", "officerRoleId": "ROLE_ID" }]
}
```

- `name` is only a label for you; the bot uses the server's live name.
- Get IDs by enabling _Developer Mode_ in Discord (User Settings → Advanced), then right-clicking a server or role → _Copy ID_.
- The bot refuses to start with an empty allowlist. With no servers listed, it would leave every server.

### Run only one instance at a time

The test and production servers share one bot application and token. Every running copy of the bot receives events from both servers, so two copies would both answer DMs and race each other on slash commands. To test a branch locally, stop the homelab instance first (`docker compose stop` in its directory on the server, `docker compose start` afterwards).

## Scripts

| Script                    | Description                                                               |
| ------------------------- | ------------------------------------------------------------------------- |
| `npm start`               | Run the bot (JSON logs)                                                   |
| `npm run dev`             | Run with auto-restart on file changes and pretty logs                     |
| `npm run deploy-commands` | Register slash commands globally (see below)                              |
| `npm run lint`            | ESLint                                                                    |
| `npm run format`          | Format all files with Prettier (`format:check` to verify without writing) |
| `npm test`                | Run the Vitest suite once (`test:watch` to re-run on changes)             |

Both `start` and `dev` load `.env` if it exists; otherwise they read variables from the environment.

### When to run `deploy-commands`

Run it once when setting up the bot, and again whenever a command's **definition** changes: its name, description or options, or when you add or remove a command. Changes inside `execute` do not need it. Commands are registered globally, which is required for them to work in DMs. Discord limits how many commands can be created per day, so the bot does not register them on every start.

Registering again is always safe: it replaces the whole command list. If a new or changed command does not appear afterwards, reload Discord (Ctrl+R).

## Deployment

Production runs the bot as a Docker container on the homelab server. GitHub is the source of truth: the server only pulls published images and never needs this repository.

```
merge to main → run CI on main → lint, format, tests → Docker build → GHCR → WUD reports the update → you update the server
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

The first time, or whenever slash commands are missing in Discord, register them from the running image (see [When to run `deploy-commands`](#when-to-run-deploy-commands)):

```bash
docker compose run --rm bot node src/deploy-commands.js
```

The container has no open ports and no access to the Docker socket, runs as a non-root user with all Linux capabilities dropped, and its filesystem is read-only. Anything a future feature needs to keep must go in a volume mounted at `/app/data` (add one to `compose.yml` when needed); scratch files go in `/tmp`.

### Updating and rolling back

WUD watches the container and reports newer `0.1.<run>` versions. To update, set the new version in `compose.yml`'s `image:` line, then:

```bash
docker compose pull
docker compose up -d
```

When an update changes a command's definition, register the commands after `up -d`, so they come from the new image:

```bash
docker compose run --rm bot node src/deploy-commands.js
```

To roll back, set the previous version and run `docker compose up -d` again. If that version has different commands, register them again as above. Old images stay on the server until pruned.

If a new version fails to start (for example, invalid configuration), the container restarts in a loop, shown as `Restarting` in `docker compose ps`. Check `docker compose logs bot` and roll back. Nothing rolls back automatically.

## Project structure

```
.github/workflows/ci.yml    tests, then builds and publishes the Docker image
deploy/compose.yml          production Compose file template
Dockerfile                  production image
src/
  index.js                  entry point: load config, create client, load events/commands, log in
  deploy-commands.js        registers slash commands globally
  config.js                 validates .env and config.json with zod
  client.js                 discord.js client (intents, partials)
  commands/<category>/*.js  slash commands, loaded automatically
  events/*.js               event listeners, loaded automatically
  handlers/                 command dispatcher, DM handler, server allowlist
  lib/                      shared helpers (logger, membership checks, command builder)
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
- Use `respond()` rather than `interaction.reply()`, because the DM server picker may already have used the first reply.
- Then run `npm run deploy-commands`.

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
