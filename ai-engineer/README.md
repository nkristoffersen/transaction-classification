# AI Engineer Take-Home: Transaction Triage

Thanks for taking the time to do this. Everything needed is below.

The exercise should take around 3 hours. It's intentionally short. What matters more is how you handle tradeoffs under a real time constraint, not how polished the final result is.

After submission, there's a 45 to 60 minute walkthrough to go through what you built and the design choices behind it. That conversation is where most of the signal comes from, so please don't spend time writing a design doc.

## Context

Sanna is a Norwegian accounting platform. The thesis: minimize work for the business owner, maximize the accountant's efficiency, and use AI to progressively automate the accountant's workflows.

Each month, a business owner's bank transactions flow into Sanna. Today the accountant categorizes them, decides which need clarification from the owner, and drafts a follow-up question for the ambiguous ones. The task is to build a slice of that — and to prove it works.

## The exercise

The inputs, in `data/`:

- `transactions.csv` is the batch of ~50 transactions to process. Columns: `id, date, amount_nok, counterparty, description, currency`.
- `history.json` is ~150 prior categorized transactions for the same business. Use them however you like.
- `chart-of-accounts.json` is the ~20 categories available to assign, with short descriptions.
- `labeled-examples.json` is 10 transactions labeled with the right answer (category, triage, reasoning). Use them however you find useful.

Build a system that produces, for each new transaction:

1. A category from the chart of accounts (~20 buckets).
2. A triage decision: `auto-approve` (confident enough to post without review), `accountant-review` (an accountant should eyeball it first), or `owner-question` (the business owner has to be asked before it can be categorized).
3. For owner-question rows, a draft question in Norwegian to send the owner. Group sensibly, so the same person isn't asked three separate questions when one will do.

And, importantly: show that it works. There's a section on that below; it matters as much as the system itself.

How all this is exposed is up to you. A CLI is fine. A small web page is welcome but not required. Frontend craft isn't graded for this exercise.

## Stack

TypeScript or JavaScript is preferred (Node, Bun, or Deno — whichever you like). It's the production stack here, so code in the same language is easiest to discuss in the walkthrough. Other stacks are accepted, but hold the bar a bit higher on readability in that case.

For the LLM itself, use whatever's easiest to ship with. A frontier API (Claude, GPT, Gemini) is fine, and a local model via Ollama or llama.cpp is equally fine. Please don't spend your own money on API credits. A smaller or local model won't be penalized. What's graded is the architecture around the LLM, not the LLM's raw quality. A simple, well-instrumented pipeline that gets some answers wrong with a 7B local model is more interesting than a one-shot prompt that gets them right with GPT-5.

Use whatever framework fits the job best. The choice will come up in the walkthrough.

## Showing it works

Plausible output isn't the same as correct output. An LLM giving 50 plausible-looking answers is easy. Proving they're the right answers, at scale, is the actual job.

So please build a way to measure how well the system performs, run it, and show the results. Specifically:

- A repeatable script that can be re-run to produce a readable summary of how the system did.
- Something more useful than a single accuracy number. Think about what failure actually means here, and design the summary around that.
- The 10 examples in `labeled-examples.json` are a starting point, not the whole picture. Extend them with cases worth testing before trusting this in production.

A perfect headline number isn't the point. What matters is evidence of where the system fails, why it fails, and what you'd change. That conversation is where most of the signal lives.

If you have time, it'd be interesting to see your thinking on cost ($/run), latency, how trustworthy the system's own confidence reports are, or how good the Norwegian questions actually read. None required. Pick whatever you find most interesting.

## What to submit

A GitHub repo (or a zip) containing:

1. Your code, with a README listing one command to install, one to run the system, and one to run whatever you built to measure it.
2. An output file (JSON or CSV) showing the system's results on `transactions.csv`.
3. A summary of how well it did, in whatever format makes sense: text, JSON, a printed table.
4. A short `LIMITATIONS.md` with a few bullets covering what you cut and what you'd do differently.

That's it. No design doc, no screen recording.

## Constraints

- No fine-tuning. Any LLM is fair game (frontier API or local) as long as you're not training your own.
- At least one meaningful tool call somewhere in the system. Not just structured output. Up to you what the tool does.
- Owner-facing questions must be in Norwegian. Internal output can be in English.
- Aim for around 3 hours. A focused submission says more than a heroic 10 hour one. Overbuilding is graded down, not up.

Out of scope — don't build:

- Authentication, multi-tenancy, deployment.
- A polished UI.
- A custom-trained model.
- Edge case handling on things you didn't have time for. Just note them in `LIMITATIONS.md`.

## What happens next

When you're done, push to a private repo and send the link to your hiring contact, who will let you know which GitHub user to add as a collaborator. (Sending a zip is also fine if you'd rather.) Expect a confirmation within one business day, then a scheduled walkthrough. In that call, you'll:

- Show the system end-to-end, including how you measured it.
- Walk through your architecture choices and what you learned along the way.
- Talk about what you'd do differently with more time, more data, more scale.

Bring questions too. This should be a real conversation, not a one-way exam.

For anything before then, email the hiring contact you've been working with. Replies usually come same-day. Hints on architecture or design aren't available (that's part of the evaluation), but anything unclear in the brief itself is fine to ask about.

Good luck.
