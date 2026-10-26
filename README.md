# WoWForeverDiscordServerBot

Custom WoW Forever Discord server bot, built with [discord.js](https://discord.js.org) v14 and JavaScript on Node.js 24 LTS.

The bot is used mainly in a single server but supports several. It only operates in servers on an allowlist (`config.json`) and automatically leaves any other server it is added to.

## Features

- **Slash commands** are limited to members with the server's configured **Officer role** unless a command allows more members, and work only in servers. The command runs for the server it is used in.
- **Help** (`/help`): any member lists the commands they can use with a short description. `/help command:<name>` describes a command or subcommand (for example `loot` or `loot character`) with its options and examples. Commands the member cannot use are not listed or suggested, and asking for one gets the same answer as a command that does not exist. Replies are visible only to the person who asked.
- **FAQ** (`/faq`): any member gets the [FAQ](docs/faq.md) by DM, with a dropdown to open each section. Sections about commands the member cannot use are left out. If their DMs are closed, it is shown privately in the channel instead.
- **Direct messages** from members of any allowlisted server get a reply pointing to `/faq` and `/help`. DMs from anyone else are ignored.
- **New members** who join a server get that server's configured **join role**, if it has one. Bots that join are skipped. Existing members are never changed.
- **Loot tracking** (`/loot`): Officers who also hold the server's **loot role** import [Gargul](https://github.com/papa-smurf/Gargul) loot exports and ask who received what. See [Importing loot](docs/faq.md#importing-loot) and [Looking up loot](docs/faq.md#looking-up-loot).
- **Raid sign-ups** (`/raid`, `/raidsetup`, `/absence`): the bot posts [Raid-Helper](https://raid-helper.xyz) sign-up sheets, DMs each event's leader who has not signed up yet, and lets raiders record when they will be away. See [Setting up raids](docs/faq.md#setting-up-raids) and [Raid sign-ups](docs/faq.md#raid-sign-ups).

## Documentation

| Document                           | For                                                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [FAQ](docs/faq.md)                 | Using the bot: absences, raid sign-ups, raid setup and loot tracking. Also sent in Discord by `/faq`.          |
| [Development](docs/development.md) | Running a test bot locally, configuration (`.env`, `config.json`), scripts, project structure, adding commands |
| [Deployment](docs/deployment.md)   | Releasing, server setup, turning on raid sign-ups, WUD, updating and rolling back                              |
