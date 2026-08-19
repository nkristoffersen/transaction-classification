# Measurement report

- generated: 2026-08-19T19:32:16.154Z
- model: qwen/qwen3.5-9b
- transactions classified: 63, failures: 0

## Headline: can the auto-approve lane be trusted?

- automation rate: 37%
- auto-approve precision (gold agrees on category AND triage): 91%
- dangerous misses (auto-approved, gold wanted a human): 2
  - t-00033: system said professional_services/auto-approve, gold says professional_services/accountant-review (contested) — PwC consulting, 3 prior professional_services rows, but 43k is far above materiality and consulting invoices are not a fixed pattern.
  - s-90003: system said salary/auto-approve, gold says salary/accountant-review (contested) — Lønn to Kari Nordmann — salary by description even though the same person also takes owner draws. Contested triage: 25k against her usual 42k breaks the pattern the auto-approve would rest on.

## Triage matrix (gold vs system, labelled by cost)

| gold → system | count | cost |
|---|---|---|
| auto-approve → auto-approve | 21 | agreement |
| auto-approve → accountant-review | 5 | harmless-caution |
| accountant-review → auto-approve | 2 | silent-error |
| accountant-review → accountant-review | 13 | agreement |
| accountant-review → owner-question | 8 | wasted-owner-time |
| owner-question → owner-question | 14 | agreement |

## Category accuracy

- overall: 94%

| gold source | rows | category | triage |
|---|---|---|---|
| provided | 10 | 80% | 70% |
| added | 45 | 96% | 78% |
| synthetic | 8 | 100% | 75% |

Confusion pairs that actually occurred:
- gold travel → system uncertain ×2
- gold supplier_invoice → system uncertain ×1
- gold owner_draw → system salary ×1

## Confidence calibration

| self-reported | rows | category accuracy |
|---|---|---|
| HIGH | 28 | 100% |
| MEDIUM | 13 | 92% |
| LOW | 22 | 86% |

## Owner questions

- 22 transactions → 18 question(s); fallback used on 2 group(s)
- **q-fallback-001** (t-00052):
  > Hei! Kan du fortelle oss hva betalingen på 84 200 kr til NORDIC FACADE SOLUTIONS AS den 1. juni gjaldt?
- **q-001** (t-00038, t-00049, t-00048):
  > Er de tre Vipps-betalinger til Lars Hansen på 2 345,78 NOK (2. juni), 1 240 NOK (6. juni) og 680 NOK (26. juni) alle for samme type utlegg, for eksempel lønnsutbetaling eller honorar?
- **q-002** (t-00035):
  > Er beløpet på 248,12 NOK til Bolt/Uber på 5. juni 2026 for en taxitur, eller er det en annen formål?
- **q-fallback-002** (t-00053):
  > Hei! Kan du fortelle oss hva betalingen på 89 kr til ICA NÆR den 6. juni gjaldt?
- **q-003** (t-00039):
  > Er Vipps-betalingen på 323,83 NOK til Anne Berg på 7. juni 2026 en personlig utbetaling, en honorar, eller en feilregistrert transaksjon?
- **q-004** (t-00029):
  > Er kostnaden på 1 628,89 NOK til Olivia Restaurant på 14. juni 2026 for en kundemiddag, eller er det en annen type arrangement?
- **q-005** (t-00043):
  > Er utlegget på 549 NOK til SATS Norge AS på 14. juni 2026 for treningssenter, eller er det en annen type aktivitet?
- **q-006** (t-00051, t-00040):
  > Er de to kontantuttak på 5 000 NOK fra DNB (14. juni) og 4 046,2 NOK fra Sparebank 1 (22. juni) begge for liknende formål, for eksempel likviditet til en spesifikk prosjektperiode?
- **q-007** (t-00044):
  > Er abonnementet på 149 NOK til Netflix på 20. juni 2026 for strømmetjenesten, eller er det en annen type prenumering?
- **q-008** (t-00041):
  > Er dagligvarekjøpet på 396,54 NOK ved Rema 1000 på 25. juni 2026 for vanlig forsyning, eller er det noe annet?
- **q-009** (t-00047, t-00024):
  > Er utleggene på 3 456,26 NOK til Airbnb (26. juni) og 1 998,86 NOK til Comfort Hotel Oslo (27. juni) begge for overnatting under samme reiseperiode?
- **q-010** (t-00042):
  > Er dagligvarekjøpet på 795,09 NOK ved Meny på 28. juni 2026 for vanlig forsyning, eller er det noe annet?
- **q-011** (t-00046):
  > Er den internasjonale overføringen på 16 906,14 NOK via Transferwise/Wise på 28. juni 2026 for betaling til en utenlandsk leverandør, eller er det en annen formål?
- **q-012** (t-00050):
  > Er abonnementet på 340 NOK til Stripe Technology EU på 29. juni 2026 (beløp i EUR) for betalingsløsning, eller er det en annen type kostnad?
- **q-013** (t-00045):
  > Er kjøpet på 524,76 NOK til Samson Bakeri på 30. juni 2026 for bakervarer, eller er det noe annet?
- **q-014** (s-90001):
  > Er innbetalingen på 15 000 NOK fra Skatteetaten på 16. juni 2026 en skattebetaling, en refusjon, eller en annen type inntekt?
- **q-015** (s-90004):
  > Er inntekten på 30 000 NOK fra overføring fra Kari Nordmann på 10. juni 2026 en privat gave, en utbyttebetaling, eller en annen type inntekt?
- **q-016** (s-90006):
  > Er Vipps-betalingen på 240 NOK til Bakeriet AS på 11. juni 2026 for bakervarer, eller er det en annen type forretningsutlegg?

## Tool health

- search_history calls: 63 (1.00 per transaction)
- injected fallback lookups (model never called): 0
- repair rounds: 0×56, 1×6, 3×1
- unresolved contradictions after budget: 1

## Cost and latency

- tokens: 579290 in / 21145 out
- estimated cost: n/a (set EVAL_PRICE_IN / EVAL_PRICE_OUT, USD per 1M tokens)
- latency per transaction: p50 61174ms, p95 103886ms

## Determinism

- not measured this run (set EVAL_REPEAT=2)
