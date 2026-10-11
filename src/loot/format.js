// Text formatting shared by the loot commands. Times use Discord timestamp markup, which each
// viewer sees in their own time zone.

export function discordTime(seconds, style = 'f') {
  return `<t:${seconds}:${style}>`;
}

// "Bob-Realm", or "Bob" when the realm is unknown.
export function characterName({ character, realm }) {
  return realm ? `${character}-${realm}` : character;
}

// Short tags for how an award was won, e.g. "OS, SR".
export function awardTags(award) {
  const tags = [];
  if (award.offSpec) tags.push('OS');
  if (award.softReserved) tags.push('SR');
  if (award.wishlisted) tags.push('WL');
  if (award.prioritized) tags.push('PL');
  if (award.bonusLoot) tags.push('Bonus');
  return tags.join(', ');
}

function withTags(text, award) {
  const tags = awardTags(award);
  return tags ? `${text} (${tags})` : text;
}

// One line per award, for the different query views.
export const awardLines = {
  forCharacter: (award) =>
    withTags(`${discordTime(award.awardedAt, 'd')} **${award.itemName}** · ${award.raid}`, award),
  forItem: (award) =>
    withTags(
      `${discordTime(award.awardedAt, 'd')} **${characterName(award)}** · ${award.raid}`,
      award,
    ),
  forSession: (award) =>
    withTags(
      `${discordTime(award.awardedAt, 't')} **${award.itemName}** → ${characterName(award)}`,
      award,
    ),
};

export function sessionSpan({ startedAt, endedAt }) {
  return `${discordTime(startedAt, 'f')} – ${discordTime(endedAt, 't')}`;
}

// Describes one discrepancy between a stored award and a re-uploaded one.
export function discrepancyLine({ award, stored, differences }) {
  const changes = differences
    .map((difference) => {
      if (difference.field === 'character' || difference.field === 'realm') return null;
      if (difference.field === 'itemId') {
        return `item: ${stored.itemName} → ${award.itemName}`;
      }
      if (difference.field === 'awardedAt') {
        return `time: ${discordTime(stored.awardedAt, 'f')} → ${discordTime(award.awardedAt, 'f')}`;
      }
      return `${difference.label}: ${showValue(difference.stored)} → ${showValue(difference.incoming)}`;
    })
    .filter(Boolean);
  if (differences.some((d) => d.field === 'character' || d.field === 'realm')) {
    changes.unshift(`winner: ${characterName(stored)} → ${characterName(award)}`);
  }
  return (
    `**${award.itemName}** (${discordTime(stored.awardedAt, 'd')}, import #${stored.importId}): ` +
    changes.join('; ')
  );
}

function showValue(value) {
  if (value === 1) return 'yes';
  if (value === 0) return 'no';
  return value ?? 'none';
}

// Joins `lines` under `header`, dropping lines that would push the text past `limit`
// characters and noting how many were left out.
export function joinWithinLimit(header, lines, limit) {
  let text = header;
  for (let index = 0; index < lines.length; index++) {
    const remaining = lines.length - index;
    const more = `\n…and ${remaining} more.`;
    if (text.length + 1 + lines[index].length + more.length > limit) return text + more;
    text += `\n${lines[index]}`;
  }
  return text;
}
