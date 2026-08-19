import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';

describe('parseCsv', () => {
  it('parses header-keyed rows', () => {
    const rows = parseCsv('a,b\n1,2\n3,4\n', 'test');
    expect(rows).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ]);
  });

  it('honours quoted fields with commas, newlines and doubled quotes', () => {
    const rows = parseCsv('a,b\n"x, y","line1\nline2 ""quoted"""\n', 'test');
    expect(rows).toEqual([{ a: 'x, y', b: 'line1\nline2 "quoted"' }]);
  });

  it('normalises CRLF line endings', () => {
    const rows = parseCsv('a,b\r\n1,2\r\n', 'test');
    expect(rows).toEqual([{ a: '1', b: '2' }]);
  });

  it('rejects a row whose cell count disagrees with the header', () => {
    expect(() => parseCsv('a,b\n1\n', 'test')).toThrow(/line 2 has 1 cells, expected 2/);
  });

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsv('a\n"unclosed\n', 'test')).toThrow(/unterminated/);
  });

  it('rejects an empty file', () => {
    expect(() => parseCsv('', 'test')).toThrow(/empty/);
  });
});
