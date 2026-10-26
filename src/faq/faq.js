import { readFile } from 'node:fs/promises';
import path from 'node:path';

// The FAQ is docs/faq.md: GitHub shows it as a page, and /faq sends it in Discord one section at a
// time. Its layout:
//
//   # FAQ                        the title
//   Intro text.                  shown above the list of sections in Discord
//   ## Section title             a section, at most 25 (one dropdown's worth)
//   <!-- commands: raid, loot --> optional, first in a section: Discord shows the section only to
//                                members who may use one of these commands. GitHub hides it.
//   ### Question?                the section's questions and answers
//
// Each section must fit in one Discord message.

export const FAQ_PATH = path.join(import.meta.dirname, '..', '..', 'docs', 'faq.md');

// Discord's limits: characters in a message, options in a dropdown and characters in an option.
export const MESSAGE_LIMIT = 2000;
export const MAX_SECTIONS = 25;
const TITLE_LIMIT = 100;
// Room left in the contents message for a notice above it, such as "I couldn't DM you".
export const NOTICE_ROOM = 300;

const MARKER = /^<!--\s*commands:\s*(.*?)\s*-->$/;
const WEB_LINK = /\]\((https?:\/\/[^\s)]+)\)/g;

// Thrown when the FAQ is missing or does not follow the layout above.
export class FaqError extends Error {
  name = 'FaqError';
}

// `markdown` with its web links in angle brackets, so Discord shows no preview of the site under
// the message.
function withoutLinkPreviews(markdown) {
  return markdown.replace(WEB_LINK, '](<$1>)');
}

// GitHub's anchor for a heading: lower case, without punctuation, each space a hyphen.
export function headingAnchor(title) {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// Returns { title, intro, sections }; each section is { id, title, commands, markdown }. `id` is
// its anchor on GitHub, `commands` the command names from its marker (empty for everyone) and
// `markdown` its heading and text as shown in Discord. The intro is as shown in Discord too.
export function parseFaq(text) {
  let title;
  const intro = [];
  const sections = [];
  let inCodeBlock = false;

  for (const line of text.replaceAll('\r\n', '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inCodeBlock = !inCodeBlock;
    const heading = inCodeBlock ? null : /^(#{1,2}) +(.+?)\s*$/.exec(line);

    if (heading?.[1] === '#') {
      if (title !== undefined) throw new FaqError(`The FAQ has a second "# " title: "${line}"`);
      title = heading[2];
    } else if (heading) {
      sections.push({ title: heading[2], lines: [] });
    } else if (sections.length > 0) {
      sections.at(-1).lines.push(line);
    } else if (title === undefined) {
      if (line.trim()) throw new FaqError('The FAQ must start with a "# " title');
    } else {
      intro.push(line);
    }
  }

  if (title === undefined) throw new FaqError('The FAQ must start with a "# " title');
  if (sections.length === 0) throw new FaqError('The FAQ has no "## " sections');
  if (sections.length > MAX_SECTIONS) {
    throw new FaqError(`The FAQ has ${sections.length} sections; at most ${MAX_SECTIONS} fit`);
  }

  const faq = {
    title,
    intro: withoutLinkPreviews(intro.join('\n').trim()),
    sections: sections.map(buildSection),
  };
  if (faq.intro.includes('<!--')) throw new FaqError('The FAQ intro must not have comments');
  checkFaq(faq);
  return faq;
}

function buildSection({ title, lines }) {
  const body = lines.join('\n').trim().split('\n');
  const marker = MARKER.exec(body[0]);
  if (marker) body.shift();
  const text = body.join('\n').trim();
  if (!text) throw new FaqError(`FAQ section "${title}" is empty`);
  // Discord would show any other comment as text.
  if (text.includes('<!--')) {
    throw new FaqError(`FAQ section "${title}" has a comment that is not its first line`);
  }
  return {
    id: headingAnchor(title),
    title,
    commands: marker ? marker[1].split(',').map((name) => name.trim().toLowerCase()) : [],
    markdown: withoutLinkPreviews(`## ${title}\n${text}`),
  };
}

function checkFaq(faq) {
  const ids = new Set();
  for (const section of faq.sections) {
    if (section.title.length > TITLE_LIMIT) {
      throw new FaqError(`FAQ section title "${section.title}" is over ${TITLE_LIMIT} characters`);
    }
    if (!section.id || ids.has(section.id)) {
      throw new FaqError(`FAQ section "${section.title}" needs a title unlike the others`);
    }
    ids.add(section.id);
    if (section.commands.some((name) => !name)) {
      throw new FaqError(`FAQ section "${section.title}" has an empty command name in its marker`);
    }
    const length = sectionText(section).length;
    if (length > MESSAGE_LIMIT) {
      throw new FaqError(
        `FAQ section "${section.title}" is ${length} characters in Discord; at most ` +
          `${MESSAGE_LIMIT} fit in a message, so split it into two sections`,
      );
    }
  }

  const length = contentsText(faq, faq.sections).length;
  if (length > MESSAGE_LIMIT - NOTICE_ROOM) {
    throw new FaqError(
      `The FAQ's intro and list of sections are ${length} characters in Discord; at most ` +
        `${MESSAGE_LIMIT - NOTICE_ROOM} fit, so shorten the intro`,
    );
  }
}

// A section as sent in Discord.
export function sectionText(section) {
  return section.markdown;
}

// The first message /faq sends: an optional notice, the intro and the titles of `sections`.
export function contentsText(faq, sections, notice) {
  const parts = [];
  if (notice) parts.push(notice);
  parts.push(`## ${faq.title}`);
  if (faq.intro) parts.push(faq.intro);
  parts.push(
    sections.length > 0
      ? sections.map((section) => `- ${section.title}`).join('\n') +
          '\n\nChoose a section from the list below.'
      : 'There are no sections for you here yet.',
  );
  return parts.join('\n\n');
}

export async function loadFaq(filePath = FAQ_PATH) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new FaqError(`Could not read the FAQ at "${filePath}"`, { cause: error });
  }
  return parseFaq(text);
}
