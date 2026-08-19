/**
 * The CSV boundary's shape. A raw row is stringly-typed by nature; the zod
 * parse at each consuming boundary gives it a real shape.
 */

// Type alias that is not a shape — skill carve-out 4.
export type CsvRow = Record<string, string>;
