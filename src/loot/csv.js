// Builds CSV text (RFC 4180) from `rows` using `columns`: [{ header, value: (row) => any }].
export function toCsv(columns, rows) {
  const lines = [columns.map((column) => escapeCell(column.header))];
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(column.value(row))));
  }
  return `${lines.map((cells) => cells.join(',')).join('\r\n')}\r\n`;
}

function escapeCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  // Stop spreadsheet apps from running cell contents as formulas.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function isoTime(seconds) {
  return new Date(seconds * 1000).toISOString();
}
