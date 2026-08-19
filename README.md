# Transaction Triage

Classifies a month of Norwegian bank transactions against a 22-account chart, decides per
transaction whether it can post unreviewed (`auto-approve`), needs an accountant
(`accountant-review`), or requires asking the business owner (`owner-question`), and drafts
grouped questions to the owner in Norwegian.

Architecture and design decisions: [DESIGN.md](DESIGN.md). What was cut: [LIMITATIONS.md](LIMITATIONS.md).

## The three commands

Needs Docker (Compose v2). Set `USE_DOCKER=0` to run on the host with Node 24 instead —
installation then happens automatically on first run (`npm ci`).

```sh
./run.sh        # install (first run builds the image) + classify -> results.json / results.csv
./test.sh       # the offline suite: free, fast, no network, no .env
./eval.sh       # the measurement report against a real model -> report.md / report.json
```

`./run.sh` and `./eval.sh` need an endpoint: copy `.env.example` to `.env` (the scripts offer to)
and point `LLM_BASE_URL` at any OpenAI-compatible server. The shipped defaults target LM Studio
with `qwen/qwen3.5-9b`. No credentials ship with this repo; a local server needs none.

## Seeing what it does without spending tokens

```sh
./run.sh --explain-triage    # the full triage policy, computed from the live tables
./run.sh --dry-run           # the exact request for the first transaction: system message,
                             # user message, tool definition, response_format
./run.sh --only t-00038      # classify a subset (the history index still uses the full file)
```

## Outputs

| File | What it is |
|---|---|
| `results.json` | the deliverable: one row per transaction — category, triage, reason, confidence — plus the grouped Norwegian owner questions |
| `results.csv` | the same rows, flat |
| `results-raw.json` | gitignored audit: every tool call, every repair round, the full model output per transaction |
| `report.md` / `report.json` | the measurement: auto-approve precision, dangerous misses by name, triage cost matrix, accuracy split by gold source, calibration, tool health, cost/latency |

## Measuring

`./eval.sh` runs the real pipeline over all 55 transactions plus 8 synthetic adversarial rows and
judges it against `data/gold.json` (63 hand-labelled rows; the 10 shipped labels kept verbatim and
reported separately, so our own labels cannot flatter the system). Knobs, via `.env` or the shell:

```sh
EVAL_ONLY=t-00038,t-00040 ./eval.sh    # quick smoke on a few rows
EVAL_REPEAT=2 ./eval.sh                # measure run-to-run agreement
EVAL_PRICE_IN=0.15 EVAL_PRICE_OUT=0.60 ./eval.sh   # $/run at your model's prices (USD per 1M tokens)
```
