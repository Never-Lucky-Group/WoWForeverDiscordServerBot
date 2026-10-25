// Members expected to sign up: everyone with the raider role, except bots. Reads the member
// cache, which is filled at startup and kept current by the GuildMembers intent.
export function raidersOf(guild, raiderRoleId) {
  return [
    ...guild.members.cache
      .filter((member) => !member.user.bot && member.roles.cache.has(raiderRoleId))
      .values(),
  ];
}

// Splits the raiders by how they answered an event. Any sign-up counts as an answer, including
// Tentative, Late, Bench and Absence. Returns members sorted by display name:
//   missing    no sign-up and no absence
//   tentative  signed up only as Tentative (also counted as answered)
//   absent     no sign-up, but an absence covers the event's date
//   conflicts  signed up (other than as Absence) although an absence covers the event's date;
//              counted as answered, and listed so the leader can check which is right
export function sortRaiders(raiders, event, absentUserIds) {
  const classesByUser = new Map();
  for (const signUp of event.signUps) {
    if (!signUp.userId) continue;
    const classes = classesByUser.get(signUp.userId) ?? [];
    classes.push(signUp.className.toLowerCase());
    classesByUser.set(signUp.userId, classes);
  }

  const result = { missing: [], tentative: [], absent: [], conflicts: [] };
  for (const member of raiders) {
    const classes = classesByUser.get(member.id);
    const isAbsent = absentUserIds.has(member.id);
    if (classes) {
      if (isAbsent && classes.some((name) => name !== 'absence')) result.conflicts.push(member);
      else if (classes.every((name) => name === 'tentative')) result.tentative.push(member);
    } else if (isAbsent) {
      result.absent.push(member);
    } else {
      result.missing.push(member);
    }
  }
  for (const list of Object.values(result)) list.sort(byDisplayName);
  return result;
}

function byDisplayName(a, b) {
  return a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' });
}
