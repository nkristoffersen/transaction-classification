import { type CsvRow } from './csv.schema.ts';

/**
 * Minimal RFC 4180 reader. Bank exports quote free-text fields that contain
 * commas, newlines and doubled quotes, so a naive split on ',' loses data
 * silently — which is the worst way to lose it.
 */

/** Splits CSV text into rows of raw cells, honouring quoted fields. */
const parseCells = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  // Normalise line endings so a CRLF file does not leave \r on every last cell.
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"'; // escaped quote
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  // Trailing cell, unless the file ended on a newline with nothing after it.
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field');
  }

  return rows;
};

/**
 * Parses CSV text into header-keyed rows. Blank lines are skipped; a row whose
 * cell count disagrees with the header is an error rather than a silent
 * misalignment.
 */
export const parseCsv = (text: string, source: string): CsvRow[] => {
  const cells = parseCells(text).filter((row) => !(row.length === 1 && row[0]?.trim() === ''));

  const header = cells[0];
  if (header === undefined) {
    throw new Error(`${source}: file is empty`);
  }

  const columns = header.map((h) => h.trim());

  return cells.slice(1).map((row, index) => {
    if (row.length !== columns.length) {
      throw new Error(
        `${source}: line ${index + 2} has ${row.length} cells, expected ${columns.length}`,
      );
    }
    const record: CsvRow = {};
    columns.forEach((column, columnIndex) => {
      record[column] = (row[columnIndex] ?? '').trim();
    });
    return record;
  });
};
