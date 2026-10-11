import { describe, expect, it } from 'vitest';
import {
  findAllowlistedMemberships,
  findOfficerMemberships,
  hasLootRole,
} from '../src/lib/membership.js';
import {
  GUILD_A,
  GUILD_B,
  USER_ID,
  fakeClient,
  fakeGuild,
  fakeMember,
  makeBotConfig,
} from './helpers/fakes.js';

const UNLISTED = { id: '100000000000000009', officerRoleId: '200000000000000009' };

function setup() {
  const officerInA = fakeMember(USER_ID, [GUILD_A.officerRoleId]);
  const plainInB = fakeMember(USER_ID);
  const client = fakeClient({
    botConfig: makeBotConfig(GUILD_A, GUILD_B),
    guilds: [
      fakeGuild(GUILD_A, [officerInA]),
      fakeGuild(GUILD_B, [plainInB]),
      fakeGuild(UNLISTED, [fakeMember(USER_ID, [UNLISTED.officerRoleId])]),
    ],
  });
  return { client, officerInA, plainInB };
}

describe('findAllowlistedMemberships', () => {
  it('returns memberships in allowlisted guilds only', () => {
    const { client, officerInA, plainInB } = setup();
    const memberships = findAllowlistedMemberships(client, USER_ID);
    expect(memberships.map(({ guild }) => guild.id)).toEqual([GUILD_A.id, GUILD_B.id]);
    expect(memberships.map(({ member }) => member)).toEqual([officerInA, plainInB]);
    expect(memberships[0].guildConfig).toBe(GUILD_A);
  });

  it('returns nothing for a user in no allowlisted guild', () => {
    const { client } = setup();
    expect(findAllowlistedMemberships(client, '399999999999999999')).toEqual([]);
  });

  it('skips allowlisted guilds the bot is not in', () => {
    const client = fakeClient({ botConfig: makeBotConfig(GUILD_A) });
    expect(findAllowlistedMemberships(client, USER_ID)).toEqual([]);
  });
});

describe('findOfficerMemberships', () => {
  it("only returns guilds where the user has that guild's Officer role", () => {
    const { client } = setup();
    expect(findOfficerMemberships(client, USER_ID).map(({ guild }) => guild.id)).toEqual([
      GUILD_A.id,
    ]);
  });

  it("does not accept another guild's Officer role", () => {
    const client = fakeClient({
      botConfig: makeBotConfig(GUILD_A, GUILD_B),
      guilds: [fakeGuild(GUILD_A, [fakeMember(USER_ID, [GUILD_B.officerRoleId])])],
    });
    expect(findOfficerMemberships(client, USER_ID)).toEqual([]);
  });
});

describe('hasLootRole', () => {
  const lootRoleId = '500000000000000001';

  it('is true only for members holding the configured loot role', () => {
    const config = { ...GUILD_A, lootRoleId };
    expect(hasLootRole(fakeMember(USER_ID, [lootRoleId]), config)).toBe(true);
    expect(hasLootRole(fakeMember(USER_ID, [GUILD_A.officerRoleId]), config)).toBe(false);
  });

  it('is false when the guild has no loot role', () => {
    expect(hasLootRole(fakeMember(USER_ID, [GUILD_A.officerRoleId]), GUILD_A)).toBe(false);
  });
});
