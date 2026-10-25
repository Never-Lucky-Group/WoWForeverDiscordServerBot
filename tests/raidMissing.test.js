import { describe, expect, it } from 'vitest';
import { raidersOf, sortRaiders } from '../src/raids/missing.js';
import { nameList, nextReport, reminderReason, reportEmbed } from '../src/raids/report.js';
import { GUILD_A } from './helpers/fakes.js';
import { RAIDER_ROLE_ID, raidEvent, raidGuild, raidMember, signUp } from './helpers/raids.js';

const ids = (members) => members.map((member) => member.id);

describe('raidersOf', () => {
  it('returns members with the raider role, except bots', () => {
    const raider = raidMember('1', 'Raider');
    const guild = raidGuild([
      raider,
      raidMember('2', 'Not a raider', []),
      raidMember('3', 'Bot', [RAIDER_ROLE_ID], { bot: true }),
    ]);
    expect(raidersOf(guild, RAIDER_ROLE_ID)).toEqual([raider]);
  });
});

describe('sortRaiders', () => {
  const raiders = [
    raidMember('1', 'Zed'),
    raidMember('2', 'amy'),
    raidMember('3', 'Bob'),
    raidMember('4', 'Tentative Tim'),
    raidMember('5', 'Away Ann'),
    raidMember('6', 'Late Lou'),
  ];

  it('counts any sign-up as an answer and sorts each list by name', () => {
    const event = raidEvent({
      signUps: [
        signUp('3', 'Warrior'),
        signUp('4', 'Tentative'),
        signUp('6', 'Late'),
        signUp(null, 'Absence'),
      ],
    });
    const sorted = sortRaiders(raiders, event, new Set(['5']));
    expect(ids(sorted.missing)).toEqual(['2', '1']);
    expect(ids(sorted.tentative)).toEqual(['4']);
    expect(ids(sorted.absent)).toEqual(['5']);
    expect(sorted.conflicts).toEqual([]);
  });

  it('does not list a member as tentative if they also have another sign-up', () => {
    const event = raidEvent({ signUps: [signUp('4', 'Tentative'), signUp('4', 'Priest')] });
    expect(sortRaiders(raiders, event, new Set()).tentative).toEqual([]);
  });

  it('lists an absent member who signed up anyway as a conflict, not missing or absent', () => {
    const event = raidEvent({ signUps: [signUp('5', 'Mage')] });
    const sorted = sortRaiders(raiders, event, new Set(['5']));
    expect(ids(sorted.conflicts)).toEqual(['5']);
    expect(sorted.absent).toEqual([]);
    expect(ids(sorted.missing)).not.toContain('5');
  });

  it('lists a Tentative sign-up with an absence as a conflict, not tentative', () => {
    const event = raidEvent({ signUps: [signUp('4', 'Tentative')] });
    const sorted = sortRaiders(raiders, event, new Set(['4']));
    expect(ids(sorted.conflicts)).toEqual(['4']);
    expect(sorted.tentative).toEqual([]);
  });

  it('does not count an Absence sign-up with an absence as a conflict', () => {
    const event = raidEvent({ signUps: [signUp('5', 'Absence')] });
    const sorted = sortRaiders(raiders, event, new Set(['5']));
    expect(sorted.conflicts).toEqual([]);
    expect(sorted.absent).toEqual([]);
  });
});

describe('report', () => {
  it('lists names and cuts long lists short', () => {
    expect(nameList([raidMember('1', 'A_b'), raidMember('2', 'C')])).toBe('A\\_b, C');
    const many = Array.from({ length: 200 }, (_, i) => raidMember(String(i), `Member${i}`));
    const text = nameList(many);
    expect(text.length).toBeLessThanOrEqual(1024);
    expect(text).toMatch(/… and \d+ more$/);
  });

  const none = { missing: [], tentative: [], absent: [], conflicts: [] };

  it('builds the /raid missing report with only the lists that have members', () => {
    const guild = raidGuild();
    const event = raidEvent();
    const embed = reportEmbed({
      guild,
      event,
      roleId: RAIDER_ROLE_ID,
      rosterSize: 15,
      sorted: { ...none, missing: [raidMember('1', 'Amy'), raidMember('2', 'Bob')] },
      reason: 'Checked',
      checkedAt: Date.parse('2026-10-24T12:00:00Z'),
    }).toJSON();
    expect(embed.title).toBe('Missing sign-ups: Molten Core');
    expect(embed.url).toBe(
      `https://discord.com/channels/${GUILD_A.id}/${event.channelId}/${event.id}`,
    );
    expect(embed.description).toBe(
      '**Guild A**: 2 of 15 members of **Raiders** have not signed up.\n' +
        `<t:${event.startTime}:F> (<t:${event.startTime}:R>)`,
    );
    expect(embed.fields).toEqual([{ name: 'Not signed up (2)', value: 'Amy, Bob' }]);
    expect(embed.footer.text).toBe('Checked');
    expect(embed.timestamp).toBe('2026-10-24T12:00:00.000Z');
  });

  it("explains the leader's DM, with a legend and the next report", () => {
    const embed = reportEmbed({
      guild: raidGuild(),
      event: raidEvent(),
      roleId: RAIDER_ROLE_ID,
      rosterSize: 15,
      sorted: {
        ...none,
        missing: [raidMember('1', 'Amy')],
        absent: [raidMember('2', 'Bob')],
        conflicts: [raidMember('3', 'Cat')],
      },
      reason: '48-hour reminder',
      next: 'Next report: 24 hours before the event',
      forLeader: true,
    }).toJSON();
    expect(embed.description).toMatch(
      /^You lead this event in \*\*Guild A\*\*\. 1 of 15 members of \*\*Raiders\*\* has not signed up\.\n/,
    );
    expect(embed.footer.text).toBe(
      '48-hour reminder · Absent = recorded with /absence · Run /raid missing for an update · ' +
        'Next report: 24 hours before the event',
    );
  });

  it.each([
    [0, 15, 'All 15 members of **Raiders** have signed up or recorded an absence.'],
    [0, 1, 'The only member of **Raiders** has signed up or recorded an absence.'],
    [1, 1, '1 of 1 member of **Raiders** has not signed up.'],
    [0, 0, 'Nobody has the **Raiders** role.'],
  ])('sums up %i missing of %i', (missing, rosterSize, summary) => {
    const embed = reportEmbed({
      guild: raidGuild(),
      event: raidEvent(),
      roleId: RAIDER_ROLE_ID,
      rosterSize,
      sorted: { ...none, missing: Array.from({ length: missing }, () => raidMember('1', 'Amy')) },
      reason: 'x',
    }).toJSON();
    expect(embed.description.split('\n')[0]).toBe(`**Guild A**: ${summary}`);
  });

  it('says when the channel has no roster role at all', () => {
    const embed = reportEmbed({
      guild: raidGuild(),
      event: raidEvent(),
      roleId: null,
      rosterSize: 0,
      sorted: none,
      reason: 'x',
    }).toJSON();
    expect(embed.description).toMatch(
      /^\*\*Guild A\*\*: This channel has no roster role, so nobody/,
    );
  });

  it('names a deleted roster role as such', () => {
    const embed = reportEmbed({
      guild: raidGuild(),
      event: raidEvent(),
      roleId: '799999999999999999',
      rosterSize: 0,
      sorted: none,
      reason: 'x',
    }).toJSON();
    expect(embed.description).toMatch(/\*\*a deleted role\*\*/);
  });

  it('lists conflicts after the absent members', () => {
    const embed = reportEmbed({
      guild: raidGuild(),
      event: raidEvent(),
      roleId: RAIDER_ROLE_ID,
      sorted: {
        missing: [],
        tentative: [],
        absent: [raidMember('1', 'Amy')],
        conflicts: [raidMember('2', 'Bob')],
      },
      reason: 'x',
    }).toJSON();
    expect(embed.fields).toEqual([
      { name: 'Not signed up (0)', value: 'Everyone has signed up.' },
      { name: 'Absent (1)', value: 'Amy' },
      { name: 'Signed up, but has an absence (1)', value: 'Bob' },
    ]);
  });

  it('adds the DM results', () => {
    const embed = reportEmbed({
      guild: raidGuild(),
      event: raidEvent(),
      sorted: { missing: [], tentative: [], absent: [], conflicts: [] },
      reason: 'x',
      dms: { sent: [raidMember('1', 'Amy')], failed: [raidMember('2', 'Bob')] },
    }).toJSON();
    expect(embed.fields.map((field) => field.name)).toEqual([
      'Not signed up (0)',
      'DMed (1)',
      'Could not DM (1)',
    ]);
  });

  it('describes reminder points and the report after them', () => {
    expect(reminderReason({ key: '24h', hours: 24 })).toBe('24-hour reminder');
    expect(reminderReason({ key: 'close' })).toBe('Sign-ups closed');

    const points = [{ key: '48h', hours: 48 }, { key: '24h', hours: 24 }, { key: 'close' }];
    expect(nextReport(points, points[0])).toBe('Next report: 24 hours before the event');
    expect(nextReport(points, points[1])).toBe('Next report: when sign-ups close');
    expect(nextReport(points, points[2])).toBe('Last report for this event');
  });
});
