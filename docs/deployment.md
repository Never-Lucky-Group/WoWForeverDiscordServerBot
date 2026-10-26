# Deployment

Production runs the bot as a Docker container on the homelab server. GitHub is the source of truth: the server only pulls published images and never needs this repository.

```
merge to main → tag a release → run Build and Deploy → tests → Docker build → GHCR → WUD reports the update → you click Update in WUD
```

For running the bot locally and its configuration files, see [Development](development.md).

## Workflows

| Workflow         | File                           | Runs                      | Does                                              |
| ---------------- | ------------------------------ | ------------------------- | ------------------------------------------------- |
| Test             | `.github/workflows/test.yml`   | every pull request        | lint, format check and unit tests                 |
| Build and Deploy | `.github/workflows/deploy.yml` | only by hand, from `main` | tests a release tag, then builds and publishes it |

## Releasing

Deploys always come from a release tag, never from whatever is on a branch.

1. Merge to `main`.
2. Tag the merged commit with a SemVer version and push it, or create a GitHub release with that tag:

   ```bash
   git tag v0.2.0 && git push origin v0.2.0
   ```

3. **Actions → Build and Deploy → Run workflow** on `main`. Enter the tag in the **tag** box, or leave it empty to deploy the highest SemVer tag.

The workflow refuses a tag that is not `MAJOR.MINOR.PATCH` (a leading `v` is fine), does not exist, or is not on `main`'s history. It runs the lint, format check and tests against the tagged commit, then the `deploy` job, which runs in the `production` environment, builds the image from the tagged commit and publishes it to `ghcr.io/never-lucky-group/wowforeverdiscordserverbot`. New versions must be higher than every earlier one, since WUD only offers higher versions as updates.

To block merging until tests pass, add the `test` check as a required status check on `main` (**Settings → Rules** or **Branches**).

The `production` environment is ready for an approval gate: in **Settings → Environments → production**, add required reviewers and restrict deployment branches to `main`. The `deploy` job then waits for approval before publishing.

Published images get two tags:

| Tag          | Example       | Use                                                       |
| ------------ | ------------- | --------------------------------------------------------- |
| `<version>`  | `0.2.0`       | Version to run in production; the git tag without its `v` |
| `sha-<hash>` | `sha-1a2b3c4` | Finds the image built from a given commit                 |

The workflow logs in to GHCR with its built-in `GITHUB_TOKEN`, so no registry credentials are stored anywhere. Deploying an existing tag again rebuilds it on the current Node base image and replaces that version's image.

After the first publish, check the package's visibility under the Never-Lucky-Group organization's **Packages** tab and set it to **Public** if it is not, so the server and WUD can pull it without credentials. If **Public** is not offered, an organization owner must allow public packages under the organization's **Settings → Packages**. The image contains only `src/`, `docs/faq.md` (for `/faq`), `package.json` and production `node_modules` (see `.dockerignore`), never `.env` or `config.json`.

## Server setup

On the server, create a directory (for example `/opt/discord-bot`) containing:

- `compose.yml`: a copy of [`deploy/compose.yml`](../deploy/compose.yml), with `image:` set to the version to run
- `.env`: `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` and optionally `LOG_LEVEL` and `RAID_HELPER_API_KEYS` (see [Configuration](development.md#configuration) and `.env.example`). Leave `BOT_CONFIG_PATH`, `LOOT_DB_PATH` and `RAIDS_DB_PATH` unset. Run `chmod 600 .env`.
- `config.json`: the server allowlist (see [Configuration](development.md#configuration)). The container runs as uid 1000, which must be able to read it.
- `data/`: the loot and raids databases, mounted at `/app/data`. Create it with `mkdir data && sudo chown 1000:1000 data`. If the bot cannot write to it, it logs an error and runs with the `/loot`, `/raid`, `/raidsetup` and `/absence` commands disabled.

To back up the data, copy `data/loot.sqlite` and `data/raids.sqlite` together with any `-wal` and `-shm` files next to them, ideally while the bot is stopped (`docker compose stop bot`).

Then, from that directory:

```bash
docker compose pull
docker compose up -d
docker compose logs -f bot
```

The bot registers its slash commands on startup (see [Slash command registration](development.md#slash-command-registration)). To register them from the image without the running bot, use `docker compose run --rm bot node src/deploy-commands.js`.

The container has no open ports and no access to the Docker socket, runs as a non-root user with all Linux capabilities dropped, and its filesystem is read-only. Data the bot keeps goes in the `./data` volume mounted at `/app/data`; scratch files go in `/tmp`.

## Setting up raid sign-ups

Raid sign-ups are on in a server once the bot has its Raid-Helper API key:

1. In the server, run Raid-Helper's `/apikey` (it needs the Administrator or Manage Server permission) and copy the key.
2. Add it to `.env` as a JSON object of server ID → key, in single quotes so a `#` in a key is not read as a comment, and restart the bot:

   ```bash
   RAID_HELPER_API_KEYS='{"SERVER_ID":"API_KEY"}'
   ```

   The key is what turns raid sign-ups on for that server: `/raid`, `/raidsetup` and `/absence` then show up for Officers. Anyone with the key can create and change the server's Raid-Helper events, so keep it out of `config.json` and out of chat. If it leaks, run `/apikey` again to replace it. The bot warns at startup about a key for a server that is not in the allowlist.

Officers then set the raids up in Discord with `/raidsetup`; see [Setting up raids](faq.md#setting-up-raids) in the FAQ. If Raid-Helper cannot be reached or rejects the API key, the bot logs an error once and tries again every 10 minutes.

## WUD setup

[WUD](https://getwud.github.io/wud/) (What's Up Docker) watches the container, reports newer versions and provides the **Update** button. Its Compose file on the server is separate from this repository. For the button to work, WUD needs a `dockercompose` trigger named `bot` and access to the bot's directory:

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

## Updating and rolling back

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
