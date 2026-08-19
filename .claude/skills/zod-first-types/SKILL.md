---
name: zod-first-types
description: Enforces this repo's rule that TypeScript types are inferred from zod schemas rather than hand-written, and that every untrusted boundary is parsed. Use when adding or changing any `interface` or `type` declaration in src/, when adding a field to a data shape, when defining LLM structured output or tool-call arguments, when reading anything out of ai-engineer/data/, or when reviewing a diff that touches transaction.schema.ts.
---

# Types are inferred from zod, not hand-written

The schema is the single source of truth. A type is a projection of it.

```ts
// Correct — one declaration, one place to change it.
export const ClassificationSchema = z.strictObject({
  transactionId: z.string().min(1),
  category: z.string().min(1),
  triage: z.enum(['auto-approve', 'accountant-review', 'owner-question']),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;

// Wrong — a second declaration of the same facts, free to drift.
export interface Classification {
  transactionId: string;
  category: string;
  triage: 'auto-approve' | 'accountant-review' | 'owner-question';
  confidence: number;
  reasoning: string;
}
```

## Why, in this project specifically

This is a pipeline made almost entirely of boundaries. Nearly every value in it
originates outside the process, so a hand-written type asserts something nobody
checked:

- **The model is a 9B local model.** `.env.example` points at an OpenAI-compatible
  endpoint (`qwen/qwen3.5-9b` via LM Studio). It will occasionally return a missing
  field, a `confidence` of `"0.9"` as a string, a category that isn't in the chart of
  accounts, or prose wrapped around the JSON. An `interface` catches none of that;
  it is erased at build time. `ClassificationSchema.parse()` catches all of it, at
  the one place it can still be retried.
- **CSV is all strings.** Every column of `transactions.csv` — including
  `amount_nok` — arrives as a string. `z.coerce.number()` at the parse boundary is
  the difference between a real number and `"-84200.0"` silently flowing into a
  comparison. `interface Transaction { amount_nok: number }` is a lie about a
  parsed CSV row.
- **The categories live in a data file, not in the code.** The ~22 codes come from
  `chart-of-accounts.json` at runtime. Any hand-written union of them is a copy that
  drifts the moment the file changes, and there is no compiler check tying the two
  together. See [Data-driven enums](#data-driven-enums) — this one is subtle.
- **The eval is the deliverable.** The README grades evidence, not plausibility. An
  eval that scores model output it never validated is measuring its own parser.

## Where schemas live

`src/utils/transaction.schema.ts` is the schema module. Every exported data shape and
its inferred type are declared and exported there; the other modules import from it.

| File | Role | Owns schemas? |
| --- | --- | --- |
| `src/utils/transaction.schema.ts` | shapes + inferred types | yes — all of them |
| `src/utils/transaction.ts` | pipeline logic, LLM call, tool | no |
| `src/utils/transaction.eval.ts` | scoring, summary report | no |
| `src/utils/transaction.test.ts` | tests | no |
| `src/app.ts` | entry point, env, artifact write | no |

If the file grows past comfortable reading, split by boundary
(`transaction.schema.ts`, `llm.schema.ts`, `eval.schema.ts`) — never by "the types
file vs. the schemas file". That split is the thing this rule exists to prevent.

## Parse at every boundary — and only at boundaries

`.parse()` is mandatory at each of these. Nowhere else.

| Boundary | Schema | Note |
| --- | --- | --- |
| `data/transactions.csv` | `TransactionSchema` | coerce `amount_nok`, `date` |
| `data/history.json` | `HistoricalTransactionSchema` | 150 rows, has `category` |
| `data/chart-of-accounts.json` | `ChartOfAccountsSchema` | `{ accounts: [...] }` wrapper |
| `data/labeled-examples.json` | `LabeledExamplesSchema` | `{ description, fields, rows }` |
| LLM response | `ClassificationSchema` (or batch) | inside the retry, see below |
| Tool-call arguments | the tool's own schema | model-authored, therefore untrusted |
| `process.env` | `EnvSchema` | fail at startup, not at first request |
| Output artifact before write | `RunOutputSchema` | catches a malformed submission file |

Parsing the model's output *inside* the retry loop is the point — a failed parse is
a signal to re-ask, and it is the only place the pipeline can still recover. Parsing
after the loop just crashes later with less context.

## LLM structured output

The response schema and the type are the same declaration. Derive the JSON Schema
sent to the model from it rather than writing a second copy by hand:

```ts
import { z } from 'zod';

export const ClassificationSchema = z.strictObject({ /* … */ });
export type Classification = z.infer<typeof ClassificationSchema>;

// One declaration drives both the wire format and the parse.
const responseFormat = {
  type: 'json_schema',
  json_schema: { name: 'classification', schema: z.toJSONSchema(ClassificationSchema), strict: true },
};
```

`z.toJSONSchema()` emits `additionalProperties: false` for `z.strictObject`, which is
what makes `strict: true` constrained decoding work.

**The trade-off, stated plainly.** `z.strictObject` will reject a response that is
correct except for one extra key the model volunteered — and small local models
volunteer keys. That rejection is a feature at the model boundary: it turns a silent
schema mismatch into a retry with a repair message. Do not downgrade to
`z.object()` (which strips unknown keys silently) to make a flaky run go green; that
converts a measurable failure into an invisible one, and the eval is the deliverable.
If a specific field is genuinely optional in the model's output, say so in the schema
with `.optional()`.

Keep the model's field names identical to the schema's. Renaming between the prompt
and the parse is a mapping layer that will drift.

## Tool-call arguments

The README requires at least one meaningful tool call. The arguments come from the
model, so they are the least trustworthy input in the system — schema-first is not
optional there:

```ts
export const LookupHistorySchema = z.strictObject({
  counterparty: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
});
export type LookupHistoryArgs = z.infer<typeof LookupHistorySchema>;

// The same schema is the tool's advertised parameters and the guard on execution.
const tool = { name: 'lookup_history', parameters: z.toJSONSchema(LookupHistorySchema) };
const args = LookupHistorySchema.parse(JSON.parse(rawToolCall.arguments));
```

Bound the numbers (`.max(50)` above). A model asking for `limit: 100000` should get a
validation error, not a full history scan stuffed into the next prompt.

## Data-driven enums

The account codes come from `chart-of-accounts.json` at runtime. Build the enum from
the loaded file:

```ts
const chart = ChartOfAccountsSchema.parse(JSON.parse(raw));
export const AccountCodeSchema = z.enum(chart.accounts.map((a) => a.code));
```

**Know exactly what this buys and what it doesn't.** At runtime it is a real
membership check — a hallucinated `"office_snacks"` is rejected. Statically,
`z.infer` widens it to `string`, because TypeScript cannot see literals in a value
read from disk. That is the correct default here: one source of truth, enforced where
the bad value actually arrives.

If you later need per-code branching that must be exhaustive (a `switch` over
categories, a guidance table keyed by code), the escape hatch is a hard-coded
`as const` tuple plus a startup assertion that it still matches the file:

```ts
export const ACCOUNT_CODES = ['salary', 'rent', /* … */] as const;
export const AccountCodeSchema = z.enum(ACCOUNT_CODES); // literal union, exhaustive switch works

// Costs a duplicate list; earns a loud failure at startup instead of a silent one at runtime.
assertSameSet(ACCOUNT_CODES, chart.accounts.map((a) => a.code));
```

Take that trade only when something genuinely needs the literals. Duplication with an
assertion beats duplication without one; no duplication beats both.

The triage values are different — they are fixed by the brief, not by a data file, so
they are a plain `z.enum([...])` written once in the schema module and reused by the
classifier, the eval, and the tests. Never re-type those three strings anywhere else.

## Where zod cannot express the shape

Four cases, and only these four. Everything else is a violation.

1. **Generic parameters.** A reusable `LlmResult<T>` or `EvalCase<T>` — zod has no
   type variables. Keep the interface.
2. **Functions and callbacks.** Retry predicates, `onProgress` reporters, a scorer
   passed into the eval harness. Zod 4's `z.function()` is a wrapper factory, not a
   `ZodType` you can infer through.
3. **Runtime objects with identity.** The OpenAI-compatible client handle, an
   `AbortSignal`, a `Map` of counterparty → prior categorizations built from
   `history.json`. Validating one is pointless — it never crossed a boundary.
4. **Type aliases that are not shapes.** `type CsvRow = Record<string, string>`.

When one applies, split rather than give up on the whole shape: the plain data goes in
a schema, the interface holds the schema-derived type plus the inexpressible field.

```ts
export const ClassificationSchema = z.strictObject({ /* … */ });

export interface ClassifyBatchOptions {
  transactions: Transaction[];
  historyIndex: Map<string, HistoricalTransaction[]>; // carve-out 3
  signal?: AbortSignal;                               // carve-out 3
  onProgress?: (done: number, total: number) => void; // carve-out 2
}
```

Add a one-line comment naming which carve-out applies. An interface with no such
comment is treated as a violation in review.

## Composing schemas

Never re-declare a field another schema already has.

```ts
// A classified transaction is the transaction plus the classification — so it composes.
export const ClassifiedTransactionSchema = z.strictObject({
  transaction: TransactionSchema,
  classification: ClassificationSchema,
});
export type ClassifiedTransaction = z.infer<typeof ClassifiedTransactionSchema>;

// History is a transaction plus a known category.
export const HistoricalTransactionSchema = TransactionSchema.extend({
  category: AccountCodeSchema,
});
```

Use `.extend()` for supersets, `.pick()`/`.omit()` for subsets, and reuse a shared
`z.enum` rather than re-typing its members. The eval's expected shape and the
pipeline's produced shape must share the triage and category schemas — if they drift,
the eval scores against a definition the system no longer produces.

## Checking

```sh
grep -rn --include='*.ts' -E "^(export )?(interface|type) " src | grep -vE "z\.infer|typeof "
```

Every surviving line needs a carve-out comment. Then run the project's typecheck and
lint (once `package.json` exists, `npm run typecheck && npm run lint`).

## What this rule does not mean

- Do not call `.parse()` on internal wiring. The schema exists for its inferred type;
  parse only at the boundaries listed above. Re-parsing a `Classification` on its way
  into the eval is wasted work that hides where validation actually happened.
- Do not weaken a schema to make a type convenient, or to make a red run go green.
  The schema describes the data; if the type is awkward, the shape is probably wrong.
- Do not add a schema for a local variable or a one-use closure argument. This is
  about exported shapes.
- Do not use `z.coerce` outside the CSV/env boundaries. Coercion is deliberate lenience
  toward a format that is genuinely stringly-typed; applied to model output it papers
  over exactly the failure the eval is supposed to surface.
