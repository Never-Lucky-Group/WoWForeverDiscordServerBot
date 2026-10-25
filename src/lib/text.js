// `text` cut to at most `limit` characters, ending with "…" when it was cut. Discord limits the
// length of choice names, embed titles, fields and more.
export function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
