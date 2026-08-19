import { describe, expect, it } from 'vitest';
import { prose } from './text.ts';

describe('prose', () => {
  it('collapses single newlines and indentation into spaces', () => {
    expect(prose`
      One sentence that wraps
      across source lines.
    `).toBe('One sentence that wraps across source lines.');
  });

  it('keeps paragraph breaks as blank lines', () => {
    expect(prose`
      First paragraph.

      Second paragraph.
    `).toBe('First paragraph.\n\nSecond paragraph.');
  });

  // Regression: the paragraph sentinel was once a literal space, which turned
  // EVERY space into a blank line — one word per line in every prompt.
  it('never inserts breaks between ordinary words', () => {
    const result = prose`plain words separated by spaces`;
    expect(result).toBe('plain words separated by spaces');
    expect(result).not.toContain('\n');
  });

  it('leaves interpolated values exactly as they are', () => {
    const table = 'LINE_ONE\nLINE_TWO';
    expect(prose`
      Guidance:

      ${table}
    `).toBe('Guidance:\n\nLINE_ONE\nLINE_TWO');
  });
});
