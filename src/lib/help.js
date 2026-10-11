import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { canUseCommand } from './command.js';

// Builds the /help pages from each command's slash command definition and its optional `help`
// export (described in lib/command.js).

// Discord's embed size limits, in characters.
export const EMBED_LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  fields: 25,
  total: 6000,
};

const AUTOCOMPLETE_LIMIT = 25;
const CHOICE_NAME_LIMIT = 100;

const OPTION_TYPES = {
  [ApplicationCommandOptionType.String]: 'text',
  [ApplicationCommandOptionType.Integer]: 'whole number',
  [ApplicationCommandOptionType.Number]: 'number',
  [ApplicationCommandOptionType.Boolean]: 'true or false',
  [ApplicationCommandOptionType.User]: 'user',
  [ApplicationCommandOptionType.Channel]: 'channel',
  [ApplicationCommandOptionType.Role]: 'role',
  [ApplicationCommandOptionType.Mentionable]: 'user or role',
  [ApplicationCommandOptionType.Attachment]: 'file',
};

// The commands `member` may use, sorted by name.
export function usableCommands(commands, member, guildConfig) {
  return [...commands.values()]
    .filter((command) => canUseCommand(command, member, guildConfig))
    .sort((a, b) => a.data.name.localeCompare(b.data.name));
}

// A command, subcommand group or subcommand as a tree node:
//   { name, path, description, help, options, children }
// `path` is its full name, e.g. 'loot imports delete'; `help` is its hand-written help text, if
// any; `options` are its own options; `children` are its subcommand groups and subcommands.
export function commandTree(command) {
  return buildNode(command.data.toJSON(), [], command.help ?? {});
}

function buildNode(json, parentNames, commandHelp) {
  const names = [...parentNames, json.name];
  const subcommandPath = names.slice(1).join(' ');
  const options = json.options ?? [];
  return {
    name: json.name,
    path: names.join(' '),
    description: json.description,
    help: subcommandPath ? (commandHelp.subcommands?.[subcommandPath] ?? {}) : commandHelp,
    options: options.filter((option) => !isSubcommand(option)),
    children: options.filter(isSubcommand).map((option) => buildNode(option, names, commandHelp)),
  };
}

function isSubcommand(option) {
  return (
    option.type === ApplicationCommandOptionType.Subcommand ||
    option.type === ApplicationCommandOptionType.SubcommandGroup
  );
}

// The node `text` names among `commands`, e.g. 'loot' or '/loot imports delete', or null.
export function findHelpTarget(commands, text) {
  const [name, ...rest] = normalize(text).split(' ');
  const command = commands.find((candidate) => candidate.data.name === name);
  if (!command) return null;

  let node = commandTree(command);
  for (const childName of rest) {
    node = node.children.find((child) => child.name === childName);
    if (!node) return null;
  }
  return node;
}

// Autocomplete choices for /help: every command, group and subcommand of `commands` whose path
// contains the typed text.
export function helpChoices(commands, text) {
  const query = normalize(text);
  return commands
    .flatMap((command) => allNodes(commandTree(command)))
    .filter((node) => node.path.includes(query))
    .slice(0, AUTOCOMPLETE_LIMIT)
    .map((node) => ({
      name: truncate(`/${node.path} — ${node.description}`, CHOICE_NAME_LIMIT),
      value: node.path,
    }));
}

function allNodes(node) {
  return [node, ...node.children.flatMap(allNodes)];
}

function leaves(node) {
  return node.children.length === 0 ? [node] : node.children.flatMap(leaves);
}

function normalize(text) {
  return text.trim().replace(/^\//, '').toLowerCase().split(/\s+/).join(' ');
}

// The page listing `commands` with their short descriptions.
export function commandListEmbed(commands) {
  return buildEmbed({
    title: 'Commands',
    description:
      commands
        .map((command) => `\`/${command.data.name}\` — ${command.data.description}`)
        .join('\n') || 'There are no commands you can use here.',
    footer: 'Use /help command:<name> for details, options and examples.',
  });
}

// The page for one node: a command or group lists its subcommands; a subcommand, or a command
// without any, describes its options.
export function helpPageEmbed(node) {
  const fields = [];
  let footer;

  if (node.children.length > 0) {
    for (const leaf of leaves(node)) {
      fields.push({ name: usage(leaf), value: leaf.description });
    }
    footer = `Use /help command:${node.path} <subcommand> for its options and examples.`;
  } else {
    fields.push({ name: 'Usage', value: `\`${usage(node)}\`` });
    if (node.options.length > 0) {
      fields.push({ name: 'Options', value: node.options.map(describeOption).join('\n\n') });
    }
  }

  if (node.help.examples?.length > 0) {
    fields.push({
      name: 'Examples',
      value: node.help.examples
        .map((example) => `\`${example.usage}\`\n${example.description}`)
        .join('\n\n'),
    });
  }

  return buildEmbed({
    title: `/${node.path}`,
    description: node.help.description || node.description,
    fields,
    footer,
  });
}

// e.g. "/loot character name [weeks] [raid]"
function usage(node) {
  const options = node.options.map((option) =>
    option.required ? option.name : `[${option.name}]`,
  );
  return [`/${node.path}`, ...options].join(' ');
}

// e.g. "`weeks` · whole number, 1–520 · optional\nOnly the last N raid weeks"
function describeOption(option) {
  let type = OPTION_TYPES[option.type] ?? 'value';
  const { min_value: min, max_value: max } = option;
  if (min !== undefined && max !== undefined) type += `, ${min}–${max}`;
  else if (min !== undefined) type += `, at least ${min}`;
  else if (max !== undefined) type += `, at most ${max}`;
  const lines = [
    `\`${option.name}\` · ${type} · ${option.required ? 'required' : 'optional'}`,
    option.description,
  ];
  if (option.choices?.length > 0) {
    lines.push(`One of: ${option.choices.map((choice) => choice.name).join(', ')}`);
  }
  return lines.join('\n');
}

// Builds an embed, shortening text that would exceed Discord's limits and dropping fields past
// the 25th. If the total is still too long, the description is shortened first, then trailing
// fields are dropped.
function buildEmbed({ title, description, fields = [], footer }) {
  const embed = {
    title: truncate(title, EMBED_LIMITS.title),
    description: truncate(description, EMBED_LIMITS.description),
    fields: fields.slice(0, EMBED_LIMITS.fields).map(({ name, value }) => ({
      name: truncate(name, EMBED_LIMITS.fieldName),
      value: truncate(value, EMBED_LIMITS.fieldValue),
    })),
    footer: footer && truncate(footer, EMBED_LIMITS.footer),
  };

  const overflow = embedLength(embed) - EMBED_LIMITS.total;
  if (overflow > 0) {
    embed.description = truncate(
      embed.description,
      Math.max(1, embed.description.length - overflow),
    );
  }
  while (embedLength(embed) > EMBED_LIMITS.total && embed.fields.length > 0) {
    embed.fields.pop();
  }

  const builder = new EmbedBuilder().setTitle(embed.title).setDescription(embed.description);
  if (embed.fields.length > 0) builder.addFields(embed.fields);
  if (embed.footer) builder.setFooter({ text: embed.footer });
  return builder;
}

function embedLength({ title, description, fields, footer }) {
  return (
    title.length +
    description.length +
    (footer?.length ?? 0) +
    fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
