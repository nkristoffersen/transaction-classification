/**
 * `prose` — a tagged template for the long guidance strings.
 *
 * Most of this system's domain knowledge is written as multi-line English that
 * ends up in a JSON Schema `description`. Written with `+` concatenation it is
 * unreadable; written as a plain template literal it carries the source
 * indentation into the prompt. This collapses the wrapping and indentation of
 * the literal parts while leaving interpolated values exactly as they are, so
 * a pre-rendered guidance block keeps its own line breaks.
 *
 *   prose`
 *     One sentence that wraps
 *     across source lines.
 *
 *     ${renderGuidance(TABLE)}
 *   `
 *
 * gives "One sentence that wraps across source lines.\n\n<table>".
 */

// A sentinel that cannot occur in source text, written as an escape so it
// survives copy-paste — a paragraph break is first parked on it, then turned
// back into a blank line after single newlines have been collapsed to spaces.
const PARAGRAPH_BREAK = '\u0001';

const collapse = (chunk: string): string =>
  chunk
    .replace(/[ \t]*\n[ \t]*\n[ \t\n]*/g, PARAGRAPH_BREAK)
    .replace(/[ \t]*\n[ \t]*/g, ' ')
    .replaceAll(PARAGRAPH_BREAK, '\n\n');

export const prose = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let out = '';
  strings.forEach((chunk, index) => {
    out += collapse(chunk);
    if (index < values.length) out += String(values[index]);
  });
  return out.trim();
};
