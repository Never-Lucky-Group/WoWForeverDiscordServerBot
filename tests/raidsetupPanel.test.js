import { Colors, ComponentType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import raidsetup from '../src/commands/raids/raidsetup.js';
import { NO_PERMISSION_MESSAGE } from '../src/handlers/commandInteraction.js';
import { LEADER_BOT_MESSAGE } from '../src/raids/handlers/setup.js';
import { PANEL_CLOSED_NOTE, PANEL_IDLE_MS } from '../src/raids/handlers/panel.js';
import { GUILD_A, USER_ID } from './helpers/fakes.js';
import {
  GROUP_B_CHANNEL_ID,
  GROUP_B_ROLE_ID,
  MOLTEN_CORE,
  ONYXIA,
  RAIDER_ROLE_ID,
  RAID_SETTINGS,
  modalFields,
  modalValues,
  raidGuild,
  raidInteraction,
  raidMember,
  raidOptions,
  raidStore,
  storedEvent,
} from './helpers/raids.js';

// Saturday 2026-10-24, midday UTC.
const NOW = Date.parse('2026-10-24T12:00:00Z');
const BOT_ID = '740000000000000001';
const officer = () => raidMember(USER_ID, 'Officer', [GUILD_A.officerRoleId]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

// Opens /raidsetup panel. Returns the panel's handles:
//   click(action, { values, form, by })  clicks a button or chooses `values` in a dropdown; a
//       form it opens is submitted with its values changed by `form` (see modalFields()), or
//       closed with `form: null`. Returns { modal }, the form it opened.
//   shown()  the panel message as last sent
//   end(reason)  closes the panel as its collector does
async function openPanel({ store = raidStore(), member = officer(), ...rest } = {}) {
  const setup = raidInteraction({
    commandName: 'raidsetup',
    options: raidOptions('panel'),
    guild: raidGuild([member]),
    member,
    store,
    ...rest,
  });
  const { interaction } = setup;
  const handlers = {};
  const collector = {
    ended: false,
    on(event, handler) {
      handlers[event] = handler;
      return collector;
    },
    resetTimer: vi.fn(),
    stop: vi.fn((reason) => {
      collector.ended = true;
      handlers.end(new Map(), reason);
    }),
  };
  const message = { createMessageComponentCollector: vi.fn(() => collector) };
  let shown;
  interaction.reply = vi.fn((payload) => {
    interaction.replied = true;
    shown = payload;
    return Promise.resolve({ resource: { message } });
  });
  interaction.editReply = vi.fn((payload) => {
    shown = { ...shown, ...payload };
    return Promise.resolve({});
  });
  await raidsetup.execute(interaction, setup.context);

  let clicks = 0;
  // Reply methods that show what they are given as the panel.
  const answerable = (fields) => {
    const target = {
      deferred: false,
      replied: false,
      client: interaction.client,
      ...fields,
      update: vi.fn((payload) => {
        target.replied = true;
        shown = payload;
        return Promise.resolve();
      }),
      deferUpdate: vi.fn(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn((payload) => {
        shown = { ...shown, ...payload };
        return Promise.resolve();
      }),
      followUp: vi.fn(() => Promise.resolve()),
      reply: vi.fn(() => Promise.resolve()),
    };
    return target;
  };

  async function click(action, { values, form = {}, by = member, bots = [] } = {}) {
    let modal;
    const user = { id: by.id };
    const component = answerable({
      id: `50000000000000000${++clicks}`,
      customId: `raidsetup-panel:${action}`,
      user,
      member: by,
      values,
      showModal: vi.fn((shownModal) => {
        modal = shownModal;
        component.replied = true;
        return Promise.resolve();
      }),
      awaitModalSubmit: vi.fn(async ({ filter }) => {
        if (form === null) throw new Error('Collector received no interactions');
        const submit = answerable({
          customId: modal.toJSON().custom_id,
          user,
          member: by,
          fields: modalFields(modal, form, { bots }),
        });
        if (!filter(submit)) throw new Error('Collector received no interactions');
        return submit;
      }),
    });
    await handlers.collect(component);
    return { modal, component };
  }

  return {
    ...setup,
    collector,
    message,
    click,
    shown: () => shown,
    end: (reason) => handlers.end(new Map(), reason),
  };
}

// The panel is the last embed; the result of the last change, when there is one, comes before it.
const description = (panel) => panel.shown().embeds.at(-1).toJSON().description;
const title = (panel) => panel.shown().embeds.at(-1).toJSON().title;
const result = (panel) => {
  const { embeds } = panel.shown();
  if (embeds.length < 2) return null;
  const { title: heading, description: text = '', color } = embeds[0].toJSON();
  return { title: heading, text, color };
};
const componentIds = (panel) =>
  panel
    .shown()
    .components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
const formOptions = (modal, id) =>
  modal.toJSON().components.find(({ component }) => component.custom_id === id).component.options;
const defaults = (modal, id) =>
  modal.toJSON().components.find(({ component }) => component.custom_id === id).component
    .default_values ?? [];

describe('/raidsetup panel', () => {
  it('shows the settings and events privately, only to the user who opened it', async () => {
    const panel = await openPanel();
    expect(panel.interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: expect.any(Number), allowedMentions: { parse: [] } }),
    );
    const filter = panel.message.createMessageComponentCollector.mock.calls[0][0].filter;
    expect(filter({ user: { id: USER_ID } })).toBe(true);
    expect(filter({ user: { id: '1' } })).toBe(false);

    expect(title(panel)).toBe('Raid setup');
    expect(description(panel)).toContain('Time zone: UTC');
    expect(description(panel)).toContain(`Roster role: <@&${RAIDER_ROLE_ID}>`);
    expect(description(panel)).toContain('Reminders: 48, 24 hours before');
    expect(description(panel)).toContain('**Events (2)**');
    expect(description(panel)).toContain(
      '**Molten Core**: <#720000000000000001> · Wednesdays 19:30, posted when the previous raid starts',
    );
    expect(description(panel)).toContain('**Onyxia**: <#720000000000000001> · Only with /raid');
    expect(componentIds(panel)).toEqual([
      'raidsetup-panel:choose',
      'raidsetup-panel:add',
      'raidsetup-panel:settings',
    ]);
  });

  it('offers only Add event and Settings when there are no events', async () => {
    const panel = await openPanel({ store: raidStore({ events: [] }) });
    expect(description(panel)).toContain('No raid events yet');
    expect(componentIds(panel)).toEqual(['raidsetup-panel:add', 'raidsetup-panel:settings']);
  });

  it('closes 14 minutes after it last answered, taking its buttons away', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(NOW);
    const panel = await openPanel();
    vi.advanceTimersByTime(PANEL_IDLE_MS - 1000);
    // Answering starts the time again; a form opened and dismissed does not.
    await panel.click('back');
    vi.advanceTimersByTime(5 * 60_000);
    await panel.click('add', { form: null });
    vi.advanceTimersByTime(PANEL_IDLE_MS - 5 * 60_000 - 1000);
    expect(panel.collector.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(panel.collector.stop).toHaveBeenCalledWith('idle');
    expect(panel.shown()).toMatchObject({ content: PANEL_CLOSED_NOTE, components: [] });
  });

  it('still saves a form submitted after it closed, and stays closed', async () => {
    const panel = await openPanel();
    panel.end('idle');
    await panel.click('settings', { form: { 'member-dms': ['on'] } });
    expect(panel.store.getSettings(GUILD_A.id).memberDms).toBe(true);
    expect(panel.shown().content).toBe(PANEL_CLOSED_NOTE);
    expect(result(panel).title).toBe('✅ Saved the raid settings');
    expect(panel.shown().components).toEqual([]);
  });

  it('closes when the user is no longer an Officer', async () => {
    const panel = await openPanel();
    const demoted = raidMember(USER_ID, 'Officer', [RAIDER_ROLE_ID]);
    demoted.client = panel.interaction.client;
    await panel.click('add', { by: demoted });
    expect(panel.shown()).toMatchObject({ content: NO_PERMISSION_MESSAGE, components: [] });
    expect(panel.collector.stop).toHaveBeenCalledWith('refused');
  });
});

describe('/raidsetup panel: adding an event', () => {
  const BASICS = {
    name: 'Barrow Deeps',
    channel: [GROUP_B_CHANNEL_ID],
    role: [GROUP_B_ROLE_ID],
  };

  it('asks for the basics, then the schedule, and saves only after both', async () => {
    const panel = await openPanel();
    const { modal } = await panel.click('add', { form: BASICS });
    // The template most events use and the Officer as leader are filled in.
    expect(modalValues(modal).template).toBe('wowclassic');
    expect(defaults(modal, 'leader')).toEqual([{ id: USER_ID, type: 'user' }]);

    expect(storedEvent(panel.store, 'Barrow Deeps')).toBeUndefined();
    expect(title(panel)).toBe('New event: Barrow Deeps');
    expect(componentIds(panel)).toEqual(['raidsetup-panel:next', 'raidsetup-panel:cancel-draft']);

    const second = await panel.click('next', {
      form: { weekday: ['friday'], time: '20:00', 'post-after': ['3'], title: 'The Barrow' },
    });
    expect(modalValues(second.modal).time).toBe('');
    // New events are posted when the previous raid starts unless another time is chosen.
    expect(formOptions(second.modal, 'post-after').find((option) => option.default)).toMatchObject({
      value: '0',
      label: 'When the previous raid starts',
    });
    expect(storedEvent(panel.store, 'Barrow Deeps')).toMatchObject({
      channelId: GROUP_B_CHANNEL_ID,
      templateId: 'wowclassic',
      leaderId: USER_ID,
      raiderRoleId: GROUP_B_ROLE_ID,
      title: 'The Barrow',
      weekly: { weekday: 'friday', time: '20:00', postAfterHours: 3 },
    });
    expect(result(panel)).toMatchObject({ title: '✅ Added Barrow Deeps', color: Colors.Green });
    expect(result(panel).text).toContain('Run `/raid create` once to check');
    expect(result(panel).text).toContain(`Members of <@&${GROUP_B_ROLE_ID}> see \`/absence\``);
    expect(panel.shown().content).toBe('');
    expect(title(panel)).toBe('Barrow Deeps');
    expect(panel.interaction.client.raids.scheduler.refresh).toHaveBeenCalledTimes(1);
  });

  it('adds an event posted only with /raid create when the schedule is left empty', async () => {
    const panel = await openPanel();
    await panel.click('add', { form: BASICS });
    await panel.click('next');
    const event = storedEvent(panel.store, 'Barrow Deeps');
    expect(event).toBeDefined();
    expect(event.weekly).toBeUndefined();
    expect(event.title).toBeUndefined();
  });

  it('refuses the basics at once, and opens the form again with what was typed', async () => {
    const panel = await openPanel();
    await panel.click('add', { form: { ...BASICS, name: 'molten core' } });
    expect(result(panel)).toMatchObject({ title: '❌ Not saved', color: Colors.Red });
    expect(result(panel).text).toContain('There is already an event named "Molten Core"');
    expect(result(panel).text).toContain(
      'Press **Add event** to fix it; the form keeps what you typed.',
    );
    expect(title(panel)).toBe('Raid setup');

    const { modal } = await panel.click('add', { form: null });
    expect(modalValues(modal).name).toBe('molten core');
  });

  it('refuses a bot as leader', async () => {
    const panel = await openPanel();
    await panel.click('add', { form: { ...BASICS, leader: [BOT_ID] }, bots: [BOT_ID] });
    expect(result(panel).text).toMatch(new RegExp(`^${LEADER_BOT_MESSAGE}`));
  });

  it('keeps the new event while the schedule is refused, until it is cancelled', async () => {
    const panel = await openPanel();
    await panel.click('add', { form: BASICS });
    const first = await panel.click('next', { form: { weekday: ['friday'] } });
    // A new event starts as Not weekly.
    expect(formOptions(first.modal, 'weekday').find((option) => option.default)?.value).toBe(
      'none',
    );
    expect(result(panel).text).toContain('A weekly event needs a start time');
    expect(result(panel).text).toContain('Press **Next** to fix it');
    expect(title(panel)).toBe('New event: Barrow Deeps');
    expect(storedEvent(panel.store, 'Barrow Deeps')).toBeUndefined();

    const { modal } = await panel.click('next', { form: null });
    expect(formOptions(modal, 'weekday').find((option) => option.default)?.value).toBe('friday');

    await panel.click('cancel-draft');
    expect(result(panel)).toMatchObject({
      title: 'Barrow Deeps was not added',
      text: '',
      color: Colors.Grey,
    });
    expect(title(panel)).toBe('Raid setup');
    expect(storedEvent(panel.store, 'Barrow Deeps')).toBeUndefined();
  });

  it('refuses an unknown placeholder in the title', async () => {
    const panel = await openPanel();
    await panel.click('add', { form: BASICS });
    await panel.click('next', { form: { title: 'Barrow {week}' } });
    expect(result(panel).text).toContain('The title has {week}');
    expect(storedEvent(panel.store, 'Barrow Deeps')).toBeUndefined();
    await panel.click('next', { form: { title: 'Barrow {date}' } });
    expect(storedEvent(panel.store, 'Barrow Deeps').title).toBe('Barrow {date}');
  });

  it('refuses a weekly time posted too late for the reminder hours, keeping the draft', async () => {
    const store = raidStore({ settings: { ...RAID_SETTINGS, reminderHours: [72] } });
    const panel = await openPanel({ store });
    await panel.click('add', { form: BASICS });
    await panel.click('next', {
      form: { weekday: ['friday'], time: '20:00', 'post-after': ['144'] },
    });
    expect(result(panel).text).toContain('would never be sent');
    expect(title(panel)).toBe('New event: Barrow Deeps');
  });
});

describe('/raidsetup panel: changing an event', () => {
  async function chooseMoltenCore(options) {
    const panel = await openPanel(options);
    await panel.click('choose', { values: [String(storedEvent(panel.store, 'Molten Core').id)] });
    return panel;
  }

  it('shows the event with its forms and Remove', async () => {
    const panel = await chooseMoltenCore();
    expect(title(panel)).toBe('Molten Core');
    expect(description(panel)).toContain('Weekly: Wednesday at 19:30 (UTC)');
    expect(componentIds(panel)).toEqual([
      'raidsetup-panel:basics',
      'raidsetup-panel:schedule',
      'raidsetup-panel:remove',
      'raidsetup-panel:back',
    ]);
    await panel.click('back');
    expect(title(panel)).toBe('Raid setup');
  });

  it('clears the result box when the user moves on', async () => {
    const panel = await chooseMoltenCore();
    await panel.click('schedule');
    expect(result(panel)).not.toBeNull();
    await panel.click('back');
    expect(result(panel)).toBeNull();
  });

  it('changes the basics, and an emptied roster role uses the shared one', async () => {
    const store = raidStore({ events: [{ ...MOLTEN_CORE, raiderRoleId: RAIDER_ROLE_ID }] });
    const panel = await chooseMoltenCore({ store });
    const { modal } = await panel.click('basics', { form: { template: 'wowforever', role: [] } });
    expect(modalValues(modal).name).toBe('Molten Core');
    expect(defaults(modal, 'role')).toEqual([{ id: RAIDER_ROLE_ID, type: 'role' }]);

    const event = storedEvent(store, 'Molten Core');
    expect(event.templateId).toBe('wowforever');
    expect(event.raiderRoleId).toBeUndefined();
    expect(event.weekly).toEqual(MOLTEN_CORE.weekly);
    expect(result(panel)).toMatchObject({ title: '✅ Saved Molten Core', text: '' });
    expect(title(panel)).toBe('Molten Core');
  });

  it('stops posting weekly on Not weekly, with the old time still in the form', async () => {
    const store = raidStore({ events: [{ ...MOLTEN_CORE, title: 'MC' }, ONYXIA] });
    const panel = await chooseMoltenCore({ store });
    const { modal } = await panel.click('schedule', { form: { weekday: ['none'], title: '' } });
    expect(modalValues(modal)).toMatchObject({ time: '19:30', title: 'MC' });
    expect(formOptions(modal, 'weekday').find((option) => option.default)?.value).toBe('wednesday');

    const event = storedEvent(store, 'Molten Core');
    expect(event.weekly).toBeUndefined();
    expect(event.title).toBeUndefined();
    expect(event.templateId).toBe(MOLTEN_CORE.templateId);
  });

  it('says when nothing was changed', async () => {
    const panel = await chooseMoltenCore();
    await panel.click('schedule');
    expect(result(panel)).toMatchObject({ title: 'Nothing was changed', color: Colors.Grey });
  });

  it('shows typed line breaks as lines in the description, and keeps them unedited', async () => {
    const store = raidStore({ events: [{ ...MOLTEN_CORE, description: 'Bring\\nfood' }] });
    const panel = await chooseMoltenCore({ store });
    const { modal } = await panel.click('schedule');
    expect(modalValues(modal).description).toBe('Bring\nfood');
    expect(result(panel)).toMatchObject({ title: 'Nothing was changed', color: Colors.Grey });
    expect(storedEvent(store, 'Molten Core').description).toBe('Bring\\nfood');
  });

  it('asks before removing an event', async () => {
    const panel = await chooseMoltenCore();
    await panel.click('remove');
    expect(title(panel)).toBe('Remove Molten Core?');
    await panel.click('remove-cancel');
    expect(title(panel)).toBe('Molten Core');
    expect(storedEvent(panel.store, 'Molten Core')).toBeDefined();

    await panel.click('remove');
    await panel.click('remove-confirm');
    expect(storedEvent(panel.store, 'Molten Core')).toBeUndefined();
    expect(result(panel)).toMatchObject({ title: '✅ Removed Molten Core', text: '' });
    expect(title(panel)).toBe('Raid setup');
    expect(panel.interaction.client.raids.scheduler.refresh).toHaveBeenCalledTimes(1);
  });

  it('goes back to the list when the event was removed meanwhile', async () => {
    const panel = await chooseMoltenCore();
    panel.store.deleteRaidEvent(GUILD_A.id, storedEvent(panel.store, 'Molten Core').id);
    await panel.click('basics');
    expect(result(panel).title).toBe('That raid event no longer exists');
    expect(title(panel)).toBe('Raid setup');
  });
});

describe('/raidsetup panel: settings', () => {
  it('opens with the settings and saves every field of the form', async () => {
    const panel = await openPanel();
    const { modal } = await panel.click('settings', {
      form: {
        'absence-channel': [],
        'time-zone': ['America/Los_Angeles'],
        'reminder-hours': '',
        'member-dms': ['on'],
      },
    });
    expect(modalValues(modal)['reminder-hours']).toBe('48, 24');
    expect(defaults(modal, 'roster-role')).toEqual([{ id: RAIDER_ROLE_ID, type: 'role' }]);

    expect(panel.store.getSettings(GUILD_A.id)).toEqual({
      ...RAID_SETTINGS,
      absenceChannelId: null,
      timeZone: 'America/Los_Angeles',
      reminderHours: [],
      memberDms: true,
    });
    expect(result(panel).title).toBe('✅ Saved the raid settings');
    expect(result(panel).text).toContain('read in the new time zone');
    expect(description(panel)).toContain('Time zone: America/Los_Angeles');
  });

  it('lists the US time zones first, and the current one when it is not common', async () => {
    const panel = await openPanel();
    const { modal } = await panel.click('settings', { form: null });
    const zones = formOptions(modal, 'time-zone').map((option) => option.value);
    expect(zones[0]).toBe('reset');
    expect(zones.slice(1, 8)).toEqual([
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Phoenix',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
    ]);
    expect(zones.length).toBeLessThanOrEqual(25);

    const store = raidStore({ settings: { ...RAID_SETTINGS, timeZone: 'Europe/Paris' } });
    const paris = await openPanel({ store });
    const second = await paris.click('settings', { form: null });
    expect(formOptions(second.modal, 'time-zone')[1]).toMatchObject({
      value: 'Europe/Paris',
      default: true,
    });
  });

  it('goes back to the raid reset time zone', async () => {
    const panel = await openPanel();
    const { modal } = await panel.click('settings', { form: { 'time-zone': ['reset'] } });
    expect(formOptions(modal, 'time-zone').find((option) => option.default)?.value).toBe('UTC');
    expect(panel.store.getSettings(GUILD_A.id).timeZone).toBeNull();
    expect(description(panel)).toContain('Time zone: UTC (from the raid reset)');
  });

  it('refuses reminder hours it cannot read, and opens the form again with them', async () => {
    const panel = await openPanel();
    await panel.click('settings', { form: { 'reminder-hours': 'soon' } });
    expect(result(panel).text).toContain('"soon" is not a list of reminder hours');
    expect(result(panel).text).toContain('Press **Settings** to fix it');
    expect(panel.store.getSettings(GUILD_A.id)).toEqual(RAID_SETTINGS);
    const { modal } = await panel.click('settings', { form: null });
    expect(modalValues(modal)['reminder-hours']).toBe('soon');
  });
});

it('builds forms that Discord accepts', async () => {
  const panel = await openPanel();
  await panel.click('choose', { values: [String(storedEvent(panel.store, 'Molten Core').id)] });
  for (const action of ['basics', 'schedule', 'add', 'settings']) {
    const { modal } = await panel.click(action, { form: null });
    const json = modal.toJSON();
    expect(json.title.length).toBeLessThanOrEqual(45);
    expect(json.components.length).toBeLessThanOrEqual(5);
    for (const { label, description: text, component } of json.components) {
      expect(label.length).toBeLessThanOrEqual(45);
      expect(text.length).toBeLessThanOrEqual(100);
      if (component.type === ComponentType.StringSelect) {
        expect(component.options.length).toBeLessThanOrEqual(25);
      }
    }
  }
});
