import { EmbedBuilder, escapeMarkdown } from 'discord.js';
import { logger } from '../../lib/logger.js';
import { transaction } from '../../lib/sqlite.js';
import { truncate } from '../../lib/text.js';
import { isTimeZone } from '../../lib/time.js';
import { deferPrivate, sendPrivate } from '../../loot/discord/privateReply.js';
import { formatDate, parseTimeInput, todayIn } from '../dates.js';
import { rosterRoleIds } from '../schedule.js';
import { titleProblem } from '../titles.js';
import {
  DEFAULT_POST_AFTER_HOURS,
  MAX_REMINDER_HOUR,
  MAX_REMINDER_HOURS,
  defaultSettings,
  eventRoleId,
  loadSetup,
  postAfterText,
  setupProblems,
} from '../setup.js';

// How far ahead the sheets in a channel are looked up when its event is removed or moved, so they
// keep their reminders until they start.
export const WATCH_LOOKAHEAD_SECONDS = 365 * 24 * 60 * 60;
// Discord's embed limits.
const FIELD_NAME_LIMIT = 256;
const FIELD_VALUE_LIMIT = 1024;
const MAX_EMBED_FIELDS = 25;
const EMBED_TOTAL_LIMIT = 6000;

// /raidsetup event add
export async function addEvent(interaction, context) {
  const read = readEventOptions(interaction.options);
  if (read.error) {
    await sendPrivate(interaction, { content: read.error });
    return;
  }
  const weekly = readWeekly(interaction.options, undefined);
  if (weekly.error) {
    await sendPrivate(interaction, { content: weekly.error });
    return;
  }
  const result = saveNewEvent(context, {
    ...read.fields,
    ...(weekly.weekly && { weekly: weekly.weekly }),
  });
  if (result.error) {
    await sendPrivate(interaction, { content: result.error });
    return;
  }
  const { event, setup, notes } = result;
  await sendPrivate(interaction, {
    content:
      `Added **${escapeMarkdown(event.name)}**: ${eventSummary(event, setup, context.timeZone)}` +
      notesText(notes),
  });
}

// Adds `event` (its fields, without an ID) to the server's setup, for /raidsetup event add and
// the setup panel. Returns { error } or { event, setup, notes }: the event as stored, the setup
// after the change and notes for the Officer.
export function saveNewEvent(context, event) {
  const { guild, member, guildConfig, store } = context;
  const now = nowSeconds();
  const result = transaction(store.db, () => {
    const before = loadSetup(store, guildConfig, now);
    const problems = setupProblems(
      { settings: before, events: [...before.events, event] },
      guildConfig,
    );
    if (problems.length) return { problems };
    const id = store.addRaidEvent(guild.id, event, member.id, now);
    return { id, before, after: loadSetup(store, guildConfig, now) };
  });
  if (result.problems) return { error: refusal(result.problems) };

  logger.info(
    { guildId: guild.id, userId: member.id, raidEventId: result.id, event },
    'Added a raid event',
  );
  context.scheduler?.refresh();
  return {
    event: result.after.events.find((stored) => stored.id === result.id),
    setup: result.after,
    notes: [
      `Run \`/raid create\` once to check that Raid-Helper accepts template ` +
        `\`${escapeMarkdown(event.templateId)}\`.`,
      integrationsNote(result.before, result.after),
    ].filter(Boolean),
  };
}

// What adding `event` to the server's setup now would break, as a refusal message, or null. The
// setup panel checks the first form of a new event with it before asking for the rest.
export function newEventProblem({ store, guildConfig }, event) {
  const setup = loadSetup(store, guildConfig, nowSeconds());
  const problems = setupProblems(
    { settings: setup, events: [...setup.events, event] },
    guildConfig,
  );
  return problems.length ? refusal(problems) : null;
}

// /raidsetup event edit
export async function editEvent(interaction, context) {
  const { setup, timeZone } = context;
  const current = findEvent(setup.events, interaction.options.getString('event', true));
  if (!current) {
    await sendPrivate(interaction, { content: NO_SUCH_EVENT_MESSAGE });
    return;
  }
  const read = readEventOptions(interaction.options, { partial: true });
  if (read.error) {
    await sendPrivate(interaction, { content: read.error });
    return;
  }
  const clear = interaction.options.getString('clear');
  const weeklyGiven = WEEKLY_OPTIONS.some((name) => interaction.options.get(name) !== null);
  const clearConflict =
    clear &&
    ((clear === 'weekly' && weeklyGiven) ||
      (clear === 'role' && read.fields.raiderRoleId) ||
      (clear !== 'weekly' && clear !== 'role' && read.fields[clear] !== undefined));
  if (clearConflict) {
    await sendPrivate(interaction, {
      content: `\`clear:${clear}\` cannot be used together with a new value for it.`,
    });
    return;
  }

  const result = await saveEventChange(
    context,
    current,
    (event) => {
      const updated = { ...event, ...read.fields };
      if (clear === 'role') delete updated.raiderRoleId;
      else if (clear === 'weekly') delete updated.weekly;
      else if (clear) delete updated[clear];
      if (weeklyGiven) {
        const weekly = readWeekly(interaction.options, event.weekly);
        if (weekly.error) return { error: weekly.error };
        updated.weekly = weekly.weekly;
      }
      return { updated };
    },
    // Raid-Helper may take longer than Discord's 3-second reply deadline.
    { beforeSlowWork: () => deferPrivate(interaction) },
  );
  if (result.unchanged) {
    await sendPrivate(interaction, { content: 'Nothing to change: give a new value or `clear`.' });
    return;
  }
  if (result.error) {
    await sendPrivate(interaction, { content: result.error });
    return;
  }
  const { event, notes } = result;
  await sendPrivate(interaction, {
    content:
      `Updated **${escapeMarkdown(event.name)}**: ${eventSummary(event, result.setup, timeZone)}` +
      notesText(notes),
  });
}

// Changes the event `current`, for /raidsetup event edit and the setup panel. `change(event)`
// returns { updated } or { error }; it is applied once to `current` to check it, and again to the
// stored event inside the transaction, so a change another Officer made meanwhile is not
// overwritten. `beforeSlowWork` is awaited once the change is checked, before Raid-Helper is
// asked anything. Returns { unchanged: true }, { error } or { event, setup, notes }: the event as
// changed, the setup after the change and notes for the Officer.
export async function saveEventChange(context, current, change, { beforeSlowWork } = {}) {
  const { guild, member, guildConfig, store, timeZone } = context;
  const preview = change(current);
  if (preview.error) return { error: preview.error };
  if (changedFields(current, preview.updated).length === 0) return { unchanged: true };

  await beforeSlowWork?.();
  const now = nowSeconds();
  const moving = preview.updated.channelId !== current.channelId;
  const sheets = moving ? await postedSheets(context, current.channelId, now) : null;

  const result = transaction(store.db, () => {
    const before = loadSetup(store, guildConfig, now);
    const stored = before.events.find((event) => event.id === current.id);
    if (!stored) return { problems: [`"${current.name}" was removed meanwhile.`] };
    const { updated, error } = change(stored);
    if (error) return { problems: [error] };
    const events = before.events.map((event) => (event.id === stored.id ? updated : event));
    const problems = setupProblems({ settings: before, events }, guildConfig);
    if (problems.length) return { problems };
    store.updateRaidEvent(guild.id, updated, member.id, now);
    // The sheets were looked up for the channel the event was in before the edit.
    const moved = updated.channelId !== stored.channelId && stored.channelId === current.channelId;
    const watched = moved && watchLeftChannel(store, guild.id, stored, events, sheets, before);
    return {
      stored,
      updated,
      changes: changedFields(stored, updated),
      before,
      after: loadSetup(store, guildConfig, now),
      watched,
    };
  });
  if (result.problems) return { error: refusal(result.problems) };
  const { stored, updated, changes } = result;

  logger.info(
    {
      guildId: guild.id,
      userId: member.id,
      raidEventId: stored.id,
      changes: Object.fromEntries(
        changes.map((field) => [
          field,
          { from: stored[field] ?? null, to: updated[field] ?? null },
        ]),
      ),
    },
    'Changed a raid event',
  );
  context.scheduler?.refresh();
  const postedDates = changes.includes('weekly')
    ? store.postedDates(guild.id, stored.id, todayIn(timeZone))
    : [];
  return {
    event: updated,
    setup: result.after,
    notes: [
      postedDates.length
        ? `Sheets already posted (${postedDates.map(formatDate).join(', ')}) are not moved; ` +
          'change or delete them in Raid-Helper.'
        : '',
      result.watched ? watchNote(stored.channelId, sheets) : '',
      integrationsNote(result.before, result.after),
    ].filter(Boolean),
  };
}

// /raidsetup event remove
export async function removeEvent(interaction, context) {
  const event = findEvent(context.setup.events, interaction.options.getString('event', true));
  if (!event) {
    await sendPrivate(interaction, { content: NO_SUCH_EVENT_MESSAGE });
    return;
  }
  const result = await deleteEvent(context, event, {
    beforeSlowWork: () => deferPrivate(interaction),
  });
  await sendPrivate(interaction, {
    content:
      result.error ??
      `Removed **${escapeMarkdown(result.event.name)}**. It is no longer posted or offered in ` +
        '`/raid create`.' +
        result.notes.map((note) => ` ${note}`).join(''),
  });
}

// Removes the event `event`, for /raidsetup event remove and the setup panel. `beforeSlowWork` is
// awaited before Raid-Helper is asked for the sheets already posted. Returns { error } or
// { event, notes }: the event as it was stored and notes for the Officer.
export async function deleteEvent(context, event, { beforeSlowWork } = {}) {
  const { guild, member, guildConfig, store } = context;
  await beforeSlowWork?.();
  const now = nowSeconds();
  const sheets = await postedSheets(context, event.channelId, now);
  // Read again, in case another Officer changed or removed the event while Raid-Helper was asked.
  const result = transaction(store.db, () => {
    const before = loadSetup(store, guildConfig, now);
    const stored = before.events.find((candidate) => candidate.id === event.id);
    if (!stored) return { gone: true };
    store.deleteRaidEvent(guild.id, stored.id);
    const remaining = before.events.filter((candidate) => candidate.id !== stored.id);
    // The sheets were looked up for the channel the event was in before.
    const watched =
      stored.channelId === event.channelId &&
      watchLeftChannel(store, guild.id, stored, remaining, sheets, before);
    return { stored, watched };
  });
  if (result.gone) return { error: `**${escapeMarkdown(event.name)}** was already removed.` };
  const { stored, watched } = result;

  logger.info(
    { guildId: guild.id, userId: member.id, raidEventId: stored.id, name: stored.name, watched },
    'Removed a raid event',
  );
  context.scheduler?.refresh();
  return { event: stored, notes: watched ? [watchNote(stored.channelId, sheets)] : [] };
}

// /raidsetup event list. With many events the list is split over several messages, because
// Discord limits a message's embeds to 6000 characters in all.
export async function listEvents(interaction, context) {
  const { setup, timeZone } = context;
  const fields = setup.events.map((event) => ({
    name: truncate(event.name, FIELD_NAME_LIMIT),
    value: truncate(eventSummary(event, setup, timeZone), FIELD_VALUE_LIMIT),
  }));
  if (setup.watched.length) {
    fields.push({
      name: 'Still checked after removal',
      value: truncate(
        setup.watched
          .map(
            (watched) =>
              `<#${watched.channelId}> (was ${escapeMarkdown(watched.eventName)}) until ` +
              `<t:${watched.watchUntil}:f>`,
          )
          .join('\n'),
        FIELD_VALUE_LIMIT,
      ),
    });
  }
  if (fields.length === 0) {
    const embed = new EmbedBuilder()
      .setTitle('Raid events')
      .setDescription('No raid events yet. Add one with `/raidsetup panel`.');
    await sendPrivate(interaction, { embeds: [embed] });
    return;
  }

  const pages = fieldPages(fields, EMBED_TOTAL_LIMIT - 'Raid events (10/10)'.length);
  for (const [index, page] of pages.entries()) {
    const title = pages.length > 1 ? `Raid events (${index + 1}/${pages.length})` : 'Raid events';
    await sendPrivate(interaction, {
      embeds: [new EmbedBuilder().setTitle(title).addFields(page)],
    });
  }
}

// `fields` split into pages of at most 25 fields and `limit` characters each.
function fieldPages(fields, limit) {
  const pages = [];
  let size = Infinity;
  for (const field of fields) {
    const fieldSize = field.name.length + field.value.length;
    if (size + fieldSize > limit || pages.at(-1).length === MAX_EMBED_FIELDS) {
      pages.push([]);
      size = 0;
    }
    pages.at(-1).push(field);
    size += fieldSize;
  }
  return pages;
}

// /raidsetup settings show
export async function showSettings(interaction, context) {
  await sendPrivate(interaction, { embeds: [settingsEmbed(context.setup, context.timeZone)] });
}

// /raidsetup settings set
export async function setSettings(interaction, context) {
  const { options } = interaction;
  const patch = {};
  const absenceChannel = options.getChannel('absence-channel');
  if (absenceChannel) patch.absenceChannelId = absenceChannel.id;
  const rosterRole = options.getRole('roster-role');
  if (rosterRole) patch.raiderRoleId = rosterRole.id;

  const timeZoneText = options.getString('time-zone')?.trim();
  if (timeZoneText) {
    const timeZone = canonicalTimeZone(timeZoneText);
    if (!timeZone) {
      await sendPrivate(interaction, {
        content:
          `"${escapeMarkdown(timeZoneText)}" is not a time zone. Choose one from the list, such ` +
          'as America/New_York or Europe/London.',
      });
      return;
    }
    patch.timeZone = timeZone;
  }
  const hoursText = options.getString('reminder-hours');
  if (hoursText !== null) {
    const hours = parseReminderHours(hoursText);
    if (hours.error) {
      await sendPrivate(interaction, { content: hours.error });
      return;
    }
    patch.reminderHours = hours.hours;
  }
  const memberDms = options.getBoolean('member-dms');
  if (memberDms !== null) patch.memberDms = memberDms;

  const clear = options.getString('clear');
  const clearField = clear && CLEARABLE_SETTINGS[clear];
  if (clearField) {
    if (patch[clearField] !== undefined) {
      await sendPrivate(interaction, {
        content: `\`clear:${clear}\` cannot be used together with a new value for it.`,
      });
      return;
    }
    patch[clearField] = null;
  }
  if (Object.keys(patch).length === 0) {
    await sendPrivate(interaction, { content: 'Nothing to change: give at least one option.' });
    return;
  }

  const result = saveSettings(context, patch);
  if (result.error) {
    await sendPrivate(interaction, { content: result.error });
    return;
  }
  await sendPrivate(interaction, {
    content:
      (result.changes.length
        ? 'Saved the raid settings.'
        : 'The settings already had those values.') + notesText(result.notes),
    embeds: [settingsEmbed(result.setup, result.setup.timeZone)],
  });
}

// Changes the settings in `patch` and keeps the rest, for /raidsetup settings set and the setup
// panel. Returns { error } or { changes, setup, notes }: the names of the settings that changed,
// the setup after the change and notes for the Officer.
export function saveSettings(context, patch) {
  const { guild, member, guildConfig, store } = context;
  const now = nowSeconds();
  const result = transaction(store.db, () => {
    const before = loadSetup(store, guildConfig, now);
    const current = store.getSettings(guild.id) ?? defaultSettings();
    const settings = { ...current, ...patch };
    const problems = setupProblems({ settings, events: before.events }, guildConfig);
    if (problems.length) return { problems };
    store.saveSettings(guild.id, settings, member.id, now);
    return { before, current, settings, after: loadSetup(store, guildConfig, now) };
  });
  if (result.problems) return { error: refusal(result.problems) };

  const changes = Object.keys(patch).filter(
    (field) => JSON.stringify(result.current[field]) !== JSON.stringify(result.settings[field]),
  );
  logger.info(
    {
      guildId: guild.id,
      userId: member.id,
      changes: Object.fromEntries(
        changes.map((field) => [
          field,
          { from: result.current[field], to: result.settings[field] },
        ]),
      ),
    },
    'Changed the raid settings',
  );

  const notes = [];
  if (changes.includes('timeZone')) {
    notes.push(
      'Sheets already posted keep their times, and absences keep their dates. Weekly times and ' +
        'dates typed in commands and forms are read in the new time zone from now on.',
    );
  }
  if (changes.includes('reminderHours')) {
    notes.push(
      'Reminder hours apply to sheets already posted too. A new hour that has already passed ' +
        'for one of them is sent at the next check, within 10 minutes.',
    );
  }
  const integrations = integrationsNote(result.before, result.after);
  if (integrations) notes.push(integrations);
  return { changes, setup: result.after, notes };
}

export const NO_SUCH_EVENT_MESSAGE = 'There is no such raid event. Choose one from the list.';
// The leader gets the reports by DM, which a bot cannot receive.
export const LEADER_BOT_MESSAGE = 'The leader must be a person, not a bot: they get the reports.';

const WEEKLY_OPTIONS = ['weekday', 'time', 'post-after'];
// `clear` choices of /raidsetup settings set → the setting they clear.
const CLEARABLE_SETTINGS = {
  'absence-channel': 'absenceChannelId',
  'roster-role': 'raiderRoleId',
  'time-zone': 'timeZone',
};
const EVENT_FIELDS = [
  'name',
  'channelId',
  'templateId',
  'leaderId',
  'raiderRoleId',
  'title',
  'description',
  'weekly',
];

// The event fields given in the options: { fields } or { error }. With `partial`, every option
// may be left out (for edit).
function readEventOptions(options, { partial = false } = {}) {
  const fields = {};
  const name = options.getString('name', !partial)?.trim();
  if (name !== undefined) {
    if (!name) return { error: 'The name must not be blank.' };
    fields.name = name;
  }
  const channel = options.getChannel('channel', !partial);
  if (channel) fields.channelId = channel.id;
  const templateId = options.getString('template', !partial)?.trim();
  if (templateId !== undefined) {
    if (!templateId) return { error: 'The template ID must not be blank.' };
    fields.templateId = templateId;
  }
  const leader = options.getUser('leader', !partial);
  if (leader) {
    if (leader.bot) return { error: LEADER_BOT_MESSAGE };
    fields.leaderId = leader.id;
  }
  const role = options.getRole('role');
  if (role) fields.raiderRoleId = role.id;
  for (const option of ['title', 'description']) {
    const text = options.getString(option)?.trim();
    if (text) fields[option] = text;
  }
  const titleError = fields.title && titleProblem(fields.title);
  if (titleError) return { error: titleError };
  return { fields };
}

// The weekly time from the options, filled in from `current` (for edit): { weekly } (undefined
// when none is given) or { error }.
function readWeekly(options, current) {
  const weekday = options.getString('weekday') ?? current?.weekday;
  const timeText = options.getString('time');
  const postAfter = options.getInteger('post-after');
  if (!weekday && timeText === null && postAfter === null) return {};
  let time = current?.time;
  if (timeText !== null) {
    time = parseTimeInput(timeText);
    if (!time) {
      return {
        error: `"${escapeMarkdown(timeText.trim())}" is not a time. Use a 24-hour time such as 19:30.`,
      };
    }
  }
  if (!weekday || !time) {
    return { error: 'A weekly time needs both `weekday` and `time`.' };
  }
  return {
    weekly: {
      weekday,
      time,
      postAfterHours: postAfter ?? current?.postAfterHours ?? DEFAULT_POST_AFTER_HOURS,
    },
  };
}

// The event chosen in an `event` option: by ID (the autocomplete value) or by name.
export function findEvent(events, text) {
  const value = text.trim();
  return (
    events.find((event) => String(event.id) === value) ??
    events.find((event) => event.name.toLowerCase() === value.toLowerCase()) ??
    null
  );
}

function changedFields(before, after) {
  return EVENT_FIELDS.filter(
    (field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null),
  );
}

// Raid-Helper sheets in `channelId` that have not started: { sheets, complete }. When Raid-Helper
// cannot be reached, the background loop's last fetch (28 days) is used and complete is false.
async function postedSheets({ api, apiKey, guild, scheduler }, channelId, now) {
  try {
    const events = await api.listEvents(guild.id, apiKey, {
      startTime: now,
      endTime: now + WATCH_LOOKAHEAD_SECONDS,
    });
    return {
      sheets: events.filter((event) => event.channelId === channelId && event.startTime > now),
      complete: true,
    };
  } catch (error) {
    logger.warn(
      { guildId: guild.id, channelId, err: error },
      'Could not fetch the sheets in a channel whose raid event was removed or moved',
    );
    const cached = scheduler?.upcomingEvents(guild.id) ?? [];
    return { sheets: cached.filter((event) => event.channelId === channelId), complete: false };
  }
}

// After `event` left its channel (removed, or moved to another), keeps checking that channel
// until its last posted sheet starts, unless another event still uses it. Returns whether it did.
// The channel keeps the roster role the event used, its own or the shared one, so a later change
// to the shared role cannot leave the channel without a roster.
function watchLeftChannel(store, guildId, event, remainingEvents, { sheets }, settings) {
  if (sheets.length === 0) return false;
  if (remainingEvents.some((other) => other.channelId === event.channelId)) return false;
  store.watchChannel(guildId, {
    channelId: event.channelId,
    raiderRoleId: eventRoleId(event, settings),
    eventName: event.name,
    watchUntil: Math.max(...sheets.map((sheet) => sheet.startTime)),
  });
  return true;
}

function watchNote(channelId, { sheets, complete }) {
  const last = Math.max(...sheets.map((sheet) => sheet.startTime));
  const text =
    sheets.length === 1
      ? `The sign-up sheet already posted in <#${channelId}> keeps its reminders until it starts ` +
        `on <t:${last}:f>.`
      : `The ${sheets.length} sign-up sheets already posted in <#${channelId}> keep their ` +
        `reminders until they start (the last on <t:${last}:f>).`;
  return (
    text +
    (complete ? '' : ' Raid-Helper could not be reached, so only sheets in the next 28 days count.')
  );
}

// A reminder for each roster role new to the server: members see /absence only once their role
// is added to its Integrations setting, which a bot cannot change.
function integrationsNote(before, after) {
  const known = rosterRoleIds(before);
  const added = [...rosterRoleIds(after)].filter((roleId) => !known.has(roleId));
  if (added.length === 0) return '';
  return (
    `Members of ${added.map((roleId) => `<@&${roleId}>`).join(', ')} see \`/absence\` only ` +
    'once the role is added under **Server Settings → Integrations →** this bot ' +
    '**→ /absence**.'
  );
}

// One event's setup as lines, e.g. for /raidsetup event list.
export function eventSummary(event, setup, timeZone) {
  const roleId = eventRoleId(event, setup);
  const lines = [
    `Posts in <#${event.channelId}> with template \`${escapeMarkdown(event.templateId)}\`; ` +
      `leader <@${event.leaderId}>`,
    'Roster: ' +
      (event.raiderRoleId
        ? `<@&${event.raiderRoleId}>`
        : roleId
          ? `<@&${roleId}> (shared)`
          : 'none yet'),
    event.weekly
      ? `Weekly: ${capitalize(event.weekly.weekday)} at ${event.weekly.time} (${timeZone}), ` +
        `posted ${postAfterText(event.weekly.postAfterHours)}`
      : 'Posted only with `/raid create`',
  ];
  if (event.title) lines.push(`Title: ${escapeMarkdown(event.title)}`);
  if (event.description) {
    lines.push(
      `Description: ${escapeMarkdown(truncate(event.description.replace(/\s+/g, ' '), 80))}`,
    );
  }
  return lines.join('\n');
}

function settingsEmbed(setup, timeZone) {
  return new EmbedBuilder().setTitle('Raid settings').addFields(
    {
      name: 'Absences channel',
      value: setup.absenceChannelId
        ? `<#${setup.absenceChannelId}>`
        : 'Not set: `/absence add` is off until it is.',
    },
    {
      name: 'Shared roster role',
      value: setup.raiderRoleId
        ? `<@&${setup.raiderRoleId}>`
        : 'Not set: every event needs its own roster role.',
    },
    {
      name: 'Time zone',
      value: setup.timeZoneSetting ? timeZone : `${timeZone} (from the raid reset; not set)`,
    },
    {
      name: 'Reminder hours',
      value: setup.reminderHours.length
        ? `${setup.reminderHours.join(', ')} hours before each event, and when sign-ups close`
        : 'Only when sign-ups close',
    },
    { name: 'Member DMs', value: setup.memberDms ? 'On' : 'Off' },
  );
}

// "48, 24" (or "none") as hours: { hours } (largest first) or { error }.
export function parseReminderHours(text) {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === 'none') return { hours: [] };
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const hours = parts.map(Number);
  const help =
    `Use up to ${MAX_REMINDER_HOURS} different whole hours from 1 to ${MAX_REMINDER_HOUR}, ` +
    'such as `48, 24`, or `none`.';
  if (
    parts.length === 0 ||
    parts.length > MAX_REMINDER_HOURS ||
    hours.some((hour) => !Number.isInteger(hour) || hour < 1 || hour > MAX_REMINDER_HOUR) ||
    new Set(hours).size !== hours.length
  ) {
    return { error: `"${escapeMarkdown(text.trim())}" is not a list of reminder hours. ${help}` };
  }
  return { hours: hours.sort((a, b) => b - a) };
}

// The time zone's canonical name ("america/new_york" → "America/New_York"), or null.
export function canonicalTimeZone(text) {
  if (!isTimeZone(text)) return null;
  return new Intl.DateTimeFormat('en-US', { timeZone: text }).resolvedOptions().timeZone;
}

// `notes` as paragraphs after a reply's first line.
function notesText(notes) {
  return notes.map((note) => `\n\n${note}`).join('');
}

function refusal(problems) {
  return `Nothing was changed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
