# FAQ

Answers to common questions about the WoW Forever Discord bot: what it does and how to use it. In Discord, `/help` lists the commands you can use, with their options and examples.

## Getting started

### What does the bot do?

- **Raid sign-ups**: it posts [Raid-Helper](https://raid-helper.xyz) sign-up sheets and tells each event's leader who has not signed up yet.
- **Absences**: raiders record the days they will miss, so they are not reported as missing on those days.
- **New members** get the server's join role.

### Which commands can I use?

Run `/help` in the server. It lists only the commands you can use. `/help command:<name>`, such as `/help command:faq`, shows what a command does, its options and examples.

### Why can't I see a command?

Some commands are only for members with certain roles, and some only show up once a feature has been set up in the server. `/help` lists every command you can use.

### Can I use the commands in a DM with the bot?

No, the commands work only in the server, and the bot cannot answer questions sent to it by DM. It does send DMs, such as this FAQ and raid reminders.

### Who sees my commands and the bot's replies?

Only you. Replies say "Only you can see this". A command posts in a channel only when that is its job, such as a new absence in the absences channel.

### How do I use the FAQ in Discord?

Run `/faq` in the server. The bot DMs you the sections that apply to you, with a list to open each one. The list keeps working, so you can keep the DM. If your DMs are closed, the FAQ is shown privately in the channel instead.

### A command or option is missing or out of date

After the bot is updated, Discord may need a refresh: press Ctrl+R, or restart the app.

## Absences

<!-- commands: absence -->

### How do I tell the officers I will miss a raid?

Run `/absence add from:<date>` in the server. For several days in a row, add `to:<date>`: both days are included, up to 90 days. You can add a `reason`. The absence is posted in the absences channel without pinging anyone, and you are not reported as missing from sign-ups on those days.

### How do I type dates?

Dates autocomplete with upcoming raid dates. You can also type `2026-11-04`, `Nov 4`, `November 4th`, `4 November` or `11/4` (month first). Without a year, the next such date is used. The reply shows the date the bot understood.

### How do I see or cancel my absences?

`/absence list` shows your upcoming absences with their numbers. `/absence cancel id:<number>` cancels one, for example when your plans change. Nothing is posted when you cancel.

### What if I can make it after all?

Cancel the absence and sign up. If you sign up while you still have an absence, the event leader sees you under **Signed up, but has an absence** and has to check which is right. Signing up as Absence in Raid-Helper is fine.

### It says the absences channel is not set yet

An Officer has to choose the absences channel first, in `/raidsetup`. Until then, absences cannot be recorded.

### Can Officers manage other members' absences?

Yes. Officers can add an absence for another member, or list theirs, with the `member` option of `/absence add` and `/absence list`, and cancel anyone's absence by its number.

## Raid sign-ups

<!-- commands: absence -->

### Which raids should I sign up for?

Every raid event posted in a sign-up channel for your roster role, unless you have an absence for its date. If the guild runs separate raid groups, each group has its own role and sign-up channel, and you are expected only in your group's events.

### What counts as signed up?

Any sign-up in Raid-Helper: a class, Tentative, Late, Bench or Absence. The event leader sees Tentative sign-ups listed separately.

### Who sees that I have not signed up?

Before each raid, the event leader gets a DM listing the raiders who have not signed up yet. Officers can also check at any time.

### Why did the bot DM me about a raid?

You had not signed up for it yet, and the Officers have turned on reminder DMs. The DM has two buttons:

- **Can make it** replies with a link to the event, so you can sign up with your class.
- **Can't make it** records an absence for that date, which takes you off later reports.

You get at most one DM per event. The buttons keep working until the event starts. If your DMs are closed, the bot tries again at the next reminder, and the event leader sees you under **Could not DM**.

### When are the sign-up sheets posted?

The bot posts each weekly raid by itself, by default when the previous week's raid starts. Officers post extra raids by hand. Both appear in the raid sign-up channels.

## Setting up raids

<!-- commands: raidsetup -->

### How are raid sign-ups turned on?

Whoever runs the bot adds the server's Raid-Helper API key (from Raid-Helper's `/apikey`) to the bot's settings; see [Setting up raid sign-ups](https://github.com/Never-Lucky-Group/WoWForeverDiscordServerBot/blob/main/docs/deployment.md#setting-up-raid-sign-ups). `/raid`, `/raidsetup` and `/absence` then show up for Officers.

### How do I set up the raids?

Run `/raidsetup panel`. It shows the raid settings and events, with buttons that open short forms. It closes after 14 minutes without use; run it again to reopen it. The other `/raidsetup` commands do the same.

1. **Settings**: the absences channel, the shared roster role (the raiders), the time zone raid times are planned in, the hours before a raid at which its leader gets a report (default 48 and 24), and whether raiders who have not signed up get a DM.
2. **Add event** for each kind of raid, up to 25: its name, sign-up channel, Raid-Helper template (such as `wowforever`), leader and, optionally, its own roster role. Then, optionally, a weekly time, a title and a description.
3. Under **Server Settings → Integrations →** the bot **→ /absence**, add every roster role, so raiders can see `/absence`. The bot cannot change this setting itself; `/raidsetup` reminds you when you set a new roster role.

### Where are all the options described?

`/help command:raidsetup` and the pages of its subcommands describe every option.

### Who is a raider?

Anyone with the roster role of an event's channel: the event's own role, or the shared roster role.

### How do I run separate raid groups?

Give each group its own roster role and sign-up channel, and set that role on the group's events. Events in one channel share a role. An absence covers every group the member is in.

## Weekly raids and changes

<!-- commands: raidsetup -->

### How do weekly raids work?

An event with a weekly day and time is posted by the bot every week: by default when the previous week's raid starts, or 1-12 hours or 1-6 days after it (`post-after`), for example once that raid is over. It is not posted if its channel already has an event with the same title that day. A raid run twice a week is two events; they may share a title.

### How do I put the date in the title?

In the title, `{date}` becomes the raid's date, such as `11/4`, and `{day}` its weekday, such as `Tue`. `Molten Core {date}` posts "Molten Core 11/4" one week and "Molten Core 11/11" the next.

### How do I change or remove an event?

In `/raidsetup panel`, choose the event, then **Basics**, **Schedule & text** or **Remove**. The forms open with the current values; empty a field to clear it. `/raidsetup event edit` and `/raidsetup event remove` do the same.

### What happens to sheets already posted?

Editing an event does not move or retitle them; change or delete them in Raid-Helper. After a removal, their reminders still go out until they start. New reminder hours apply to them too; one that has already passed is sent at the next check. A new time zone applies only to weekly times and dates typed from then on. Moving a sheet to another time in Raid-Helper makes its reminders go out again.

### Why was my change refused?

It would break a rule, such as two events with one name, two roles in one channel or an event without a roster role. The reply gives the reason and nothing changes. Every change that goes through is logged with who made it.

## Posting raids and reports

<!-- commands: raid -->

### How do I post a raid by hand?

`/raid create raid:<event> date:<date>` opens a form with the start time, title and description, filled in from the event. Change what you need and press **Submit** within 15 minutes. To change one week of a weekly raid, post that date early with its own title or description; the weekly schedule then skips it.

### How do I see who has not signed up?

`/raid missing event:<event>` lists, right now, the raiders who have not signed up, those signed up only as Tentative, those with an absence, and those signed up despite an absence.

### When does the event leader get a report?

At each reminder hour (default 48 and 24 hours before the start) and when Raid-Helper closes sign-ups. A report is skipped when there is nothing to report. A reminder point that had already passed when the bot first saw the event is skipped, and after the bot was offline it sends only the latest one.

### How often does the bot check Raid-Helper?

Every 10 minutes, for the next 28 days of events in the raid channels, and straight away after a `/raidsetup` change. If Raid-Helper cannot be reached, the bot tries again at the next check.

### A weekly raid was not posted

Usually Raid-Helper rejected it, for example because of a mistyped template. The bot tries again every 10 minutes and DMs the event leader Raid-Helper's error once a day. Try `/raid create` to see the error, and fix the event with `/raidsetup`.

## Importing loot

<!-- commands: loot -->

### Who can use /loot?

Officers who also have the server's loot role.

### How do I export loot from Gargul?

1. In game, open Gargul's settings → **Exporting loot** and set the format to **Detailed (JSON)**. The bot accepts only this format: it is the only one with item names, exact award times and Gargul's ID for each award.
2. Run `/gl export`, select the raid days on the left, and copy all of the text in the box.
3. Paste it into a text file, such as `gargul-2026-11-10.json`.

### How do I import it?

Run `/loot import file:<the file>`. The bot splits the new awards into raid sessions: a gap of 6 hours or more starts a new one, and a file may have at most 4. Choose each session's raid from the list, which suggests the likeliest one, then press **Import**. Gargul does not record the raid, which is why you choose it. Nothing is stored if you cancel, wait more than 5 minutes, or the bot restarts first.

### Can I import the same raid twice?

Yes. Awards already stored are skipped, matched by Gargul's ID, so overlapping exports and exports from several Officers are safe.

### An award was changed or deleted in Gargul

Imports never change stored awards: an award that differs from the file is listed and left alone, and a deleted one is just missing from the new file. Export that raid again and run `/loot imports replace id:<upload> file:<file>`. `/loot imports list` shows the upload numbers, and `/loot imports delete` removes an upload and all its awards.

### A raid is missing from the list

The raid names are set in the bot's config by whoever runs it. Ask them to add it.

## Looking up loot

<!-- commands: loot -->

### How do I look up who got what?

- `/loot character name:<name>`: the items a character received. Names match in any case, with or without -Realm.
- `/loot item name:<item>`: who received an item.
- `/loot raid session:<session>`: everything awarded in one raid session.
- `/loot leaderboard`: characters ranked by the number of items received.

Names, items, raids and sessions autocomplete.

### How do the filters work?

- `weeks`: the last N raid weeks, where 1 means since the most recent raid reset.
- `raid`: only one raid.
- `from` and `to`: dates as YYYY-MM-DD, `to` included. Not together with `weeks`.
- `type`, for characters and the leaderboard: main spec, off spec, soft reserved, wishlisted, prioritized or bonus roll.

### Are disenchanted items counted?

No. Items given to the disenchanter are stored but never counted for a character. `/loot raid` lists them.

### How do I get the full results?

Long results have **Previous** and **Next** buttons, and **Download CSV** sends the whole result as a file. The buttons stop working after 10 minutes; run the command again.
