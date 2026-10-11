import { describe, expect, it } from 'vitest';
import { isoTime, toCsv } from '../src/loot/csv.js';

describe('toCsv', () => {
  const columns = [
    { header: 'name', value: (row) => row.name },
    { header: 'count', value: (row) => row.count },
  ];

  it('writes a header and one line per row', () => {
    expect(toCsv(columns, [{ name: 'Thrall', count: 2 }])).toBe('name,count\r\nThrall,2\r\n');
  });

  it('quotes cells with commas, quotes and line breaks', () => {
    const csv = toCsv(columns, [{ name: 'Sulfuras, "Hand"\nof Ragnaros', count: null }]);
    expect(csv).toBe('name,count\r\n"Sulfuras, ""Hand""\nof Ragnaros",\r\n');
  });

  it('stops spreadsheet apps treating cells as formulas', () => {
    expect(toCsv(columns, [{ name: '=HYPERLINK("x")', count: 1 }])).toContain(
      `"'=HYPERLINK(""x"")"`,
    );
  });
});

describe('isoTime', () => {
  it('formats Unix seconds as ISO 8601', () => {
    expect(isoTime(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});
