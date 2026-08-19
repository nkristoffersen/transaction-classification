# Measurement report

- generated: 2026-08-19T18:50:37.475Z
- model: qwen/qwen3.5-9b
- transactions classified: 63, failures: 0

## Headline: can the auto-approve lane be trusted?

- automation rate: 40%
- auto-approve precision (gold agrees on category AND triage): 84%
- dangerous misses (auto-approved, gold wanted a human): 4
  - t-00033: system said professional_services/auto-approve, gold says professional_services/accountant-review (contested) — PwC consulting, 3 prior professional_services rows, but 43k is far above materiality and consulting invoices are not a fixed pattern.
  - t-00055: system said salary/auto-approve, gold says owner_draw/accountant-review — Owner transferring to a personal account. Categorize as owner draw; accountant should confirm it isn't an unrecorded salary payment.
  - s-90003: system said salary/auto-approve, gold says salary/accountant-review (contested) — Lønn to Kari Nordmann — salary by description even though the same person also takes owner draws. Contested triage: 25k against her usual 42k breaks the pattern the auto-approve would rest on.
  - s-90005: system said utilities/auto-approve, gold says utilities/accountant-review (contested) — Telenor at ten times its recurring amount. The category is safe; blind pattern-matching that auto-approves this is exactly the dangerous miss the report exists to catch.

## Triage matrix (gold vs system, labelled by cost)

| gold → system | count | cost |
|---|---|---|
| auto-approve → auto-approve | 21 | agreement |
| auto-approve → accountant-review | 5 | harmless-caution |
| accountant-review → auto-approve | 4 | silent-error |
| accountant-review → accountant-review | 11 | agreement |
| accountant-review → owner-question | 8 | wasted-owner-time |
| owner-question → owner-question | 14 | agreement |

## Category accuracy

- overall: 94%

| gold source | rows | category | triage |
|---|---|---|---|
| provided | 10 | 80% | 60% |
| added | 45 | 96% | 78% |
| synthetic | 8 | 100% | 63% |

Confusion pairs that actually occurred:
- gold travel → system uncertain ×2
- gold supplier_invoice → system uncertain ×1
- gold owner_draw → system salary ×1

## Confidence calibration

| self-reported | rows | category accuracy |
|---|---|---|
| HIGH | 29 | 97% |
| MEDIUM | 12 | 100% |
| LOW | 22 | 86% |

HIGH is not more accurate than MEDIUM on this run — the confidence field is decoration here, and the triage gate on HIGH deserves a rethink.

## Owner questions

- 22 transactions → 18 question(s); fallback used on 18 group(s)
- **q-fallback-001** (t-00052):
  > Hei! Kan du fortelle oss hva betalingen på 84 200 kr til NORDIC FACADE SOLUTIONS AS den 1. juni gjaldt?
- **q-fallback-002** (t-00038, t-00049, t-00048):
  > Hei! Kan du fortelle oss hva betalingene på 2 345 kr til VIPPS LARS HANSEN den 2. juni, 1 240 kr til VIPPS LARS HANSEN den 6. juni, 680 kr til VIPPS LARS HANSEN den 26. juni gjaldt?
- **q-fallback-003** (t-00035):
  > Hei! Kan du fortelle oss hva betalingen på 248 kr til Bolt / Uber den 5. juni gjaldt?
- **q-fallback-004** (t-00053):
  > Hei! Kan du fortelle oss hva betalingen på 89 kr til ICA NÆR den 6. juni gjaldt?
- **q-fallback-005** (t-00039):
  > Hei! Kan du fortelle oss hva betalingen på 323 kr til VIPPS ANNE BERG den 7. juni gjaldt?
- **q-fallback-006** (t-00029):
  > Hei! Kan du fortelle oss hva betalingen på 1 628 kr til Olivia Restaurant den 14. juni gjaldt?
- **q-fallback-007** (t-00043):
  > Hei! Kan du fortelle oss hva betalingen på 549 kr til SATS Norge AS den 14. juni gjaldt?
- **q-fallback-008** (t-00051, t-00040):
  > Hei! Kan du fortelle oss hva betalingene på 5 000 kr til MINIBANK DNB den 14. juni, 4 046 kr til MINIBANK SPAREBANK 1 den 22. juni gjaldt?
- **q-fallback-009** (t-00044):
  > Hei! Kan du fortelle oss hva betalingen på 149 kr til NETFLIX den 20. juni gjaldt?
- **q-fallback-010** (t-00041):
  > Hei! Kan du fortelle oss hva betalingen på 396 kr til REMA 1000 den 25. juni gjaldt?
- **q-fallback-011** (t-00047, t-00024):
  > Hei! Kan du fortelle oss hva betalingene på 3 456 kr til AIRBNB den 26. juni, 1 998 kr til Comfort Hotel Oslo den 27. juni gjaldt?
- **q-fallback-012** (t-00042):
  > Hei! Kan du fortelle oss hva betalingen på 795 kr til MENY den 28. juni gjaldt?
- **q-fallback-013** (t-00046):
  > Hei! Kan du fortelle oss hva betalingen på 16 906 kr til TRANSFERWISE / WISE den 28. juni gjaldt?
- **q-fallback-014** (t-00050):
  > Hei! Kan du fortelle oss hva betalingen på 340 kr til STRIPE TECHNOLOGY EU den 29. juni gjaldt?
- **q-fallback-015** (t-00045):
  > Hei! Kan du fortelle oss hva betalingen på 524 kr til SAMSON BAKERI den 30. juni gjaldt?
- **q-fallback-016** (s-90001):
  > Hei! Kan du fortelle oss hva betalingen på 15 000 kr til Skatteetaten den 16. juni gjaldt?
- **q-fallback-017** (s-90004):
  > Hei! Kan du fortelle oss hva betalingen på 30 000 kr til OVERFØRING KARI NORDMANN den 10. juni gjaldt?
- **q-fallback-018** (s-90006):
  > Hei! Kan du fortelle oss hva betalingen på 240 kr til VIPPS BAKERIET AS den 11. juni gjaldt?

## Tool health

- search_history calls: 63 (1.00 per transaction)
- injected fallback lookups (model never called): 0
- repair rounds: 0×57, 1×6
- unresolved contradictions after budget: 0

## Cost and latency

- tokens: 568895 in / 20579 out
- estimated cost: n/a (set EVAL_PRICE_IN / EVAL_PRICE_OUT, USD per 1M tokens)
- latency per transaction: p50 58067ms, p95 131039ms

## Determinism

- not measured this run (set EVAL_REPEAT=2)
