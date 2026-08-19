# Measurement report

- generated: 2026-08-19T21:52:07.187Z
- model: qwen/qwen3.5-9b
- transactions classified: 63, failures: 0

## Headline: can the auto-approve lane be trusted?

- automation rate: 43%
- auto-approve precision (gold agrees on category AND triage): 85%
- dangerous misses (auto-approved, gold wanted a human): 4
  - t-00028: system said travel/auto-approve, gold says travel/accountant-review (contested) — Norwegian Air with one prior travel row. Category is clear; a flight needs its receipt and trip context.
  - t-00033: system said professional_services/auto-approve, gold says professional_services/accountant-review (contested) — PwC consulting, 3 prior professional_services rows, but 43k is far above materiality and consulting invoices are not a fixed pattern.
  - s-90003: system said salary/auto-approve, gold says salary/accountant-review (contested) — Lønn to Kari Nordmann — salary by description even though the same person also takes owner draws. Contested triage: 25k against her usual 42k breaks the pattern the auto-approve would rest on.
  - s-90008: system said meals/auto-approve, gold says meals/accountant-review (contested) — Egon lunch with 2 priors — a team lunch is deductible where client entertainment is restricted, and the description cannot tell them apart. Contested between review and asking who attended.

## Triage matrix (gold vs system, labelled by cost)

| gold → system | count | cost |
|---|---|---|
| auto-approve → auto-approve | 23 | agreement |
| auto-approve → accountant-review | 3 | harmless-caution |
| accountant-review → auto-approve | 4 | silent-error |
| accountant-review → accountant-review | 15 | agreement |
| accountant-review → owner-question | 4 | wasted-owner-time |
| owner-question → owner-question | 14 | agreement |

## Category accuracy

- overall: 92%

| gold source | rows | category | triage |
|---|---|---|---|
| provided | 10 | 80% | 90% |
| added | 45 | 93% | 82% |
| synthetic | 8 | 100% | 75% |

Confusion pairs that actually occurred:
- gold supplier_invoice → system uncertain ×2
- gold travel → system uncertain ×1 (contested rows only)
- gold personal_expense → system uncertain ×1
- gold owner_draw → system salary ×1

## Confidence calibration

| self-reported | rows | category accuracy |
|---|---|---|
| HIGH | 35 | 100% |
| MEDIUM | 10 | 90% |
| LOW | 18 | 78% |

## Owner questions

- 18 transactions → 15 question(s); fallback used on 2 group(s)
- **q-fallback-001** (t-00052):
  > Hei! Kan du fortelle oss hva betalingen på 84 200 kr til NORDIC FACADE SOLUTIONS AS den 1. juni gjaldt?
- **q-001** (t-00038, t-00049, t-00048):
  > Hva var formålet med de tre Vipps-betalinger til Lars Hansen på 2 345,78 NOK, 1 240 NOK og 680 NOK på 2., 6. og 28. juni 2026 i alt?
- **q-002** (t-00035):
  > Hva var formålet med taxiregningen på 248,12 NOK fra Bolt/Uber på 5. juni 2026?
- **q-003** (t-00053):
  > Hva var formålet med kjøpet på 89 NOK fra ICA Nær på 6. juni 2026?
- **q-004** (t-00039):
  > Hva var formålet med Vipps-betalingen på 323,83 NOK til Anne Berg på 7. juni 2026?
- **q-005** (t-00029):
  > Hva var formålet med kundemiddagen på 1 628,89 NOK hos Olivia Restaurant på 14. juni 2026?
- **q-006** (t-00043):
  > Hva var formålet med treningssenteravgiften på 549 NOK fra SATS Norge AS på 14. juni 2026?
- **q-007** (t-00051, t-00040):
  > Hvorfor trengte du kontanter på 5 000 NOK fra DNB og 4 046,2 NOK fra Sparebank 1 på 14. og 22. juni 2026, og hva skal disse beløpene brukes til?
- **q-008** (t-00041):
  > Hva var formålet med dagligvarekjøpet på 396,54 NOK fra Rema 1000 på 25. juni 2026?
- **q-fallback-002** (t-00042):
  > Hei! Kan du fortelle oss hva betalingen på 795 kr til MENY den 28. juni gjaldt?
- **q-009** (t-00046):
  > Hvem er mottakeren av den internasjonale overføringen på 16 906,14 NOK via Transferwise/Wise på 28. juni 2026, og hva var formålet?
- **q-010** (t-00050):
  > Hvilken tjeneste er abonnementet på 340 NOK fra Stripe Technology EU på 29. juni 2026 for?
- **q-011** (t-00045):
  > Hva var formålet med bakerikjøpet på 524,76 NOK fra Samson Bakeri på 30. juni 2026?
- **q-012** (s-90001):
  > Hva var formålet med innbetalingen på 15 000 NOK fra Skatteetaten på 16. juni 2026?
- **q-013** (s-90006):
  > Hva var formålet med Vipps-betalingen på 240 NOK til Bakeriet AS på 11. juni 2026?

## Tool health

- search_history calls: 63 (1.00 per transaction)
- injected fallback lookups (model never called): 0
- repair rounds: 0×52, 1×10, 3×1
- unresolved contradictions after budget: 1

## Cost and latency

- tokens: 607330 in / 23860 out
- estimated cost: n/a (set EVAL_PRICE_IN / EVAL_PRICE_OUT, USD per 1M tokens)
- latency per transaction: p50 57610ms, p95 156632ms

## Determinism

- not measured this run (set EVAL_REPEAT=2)
