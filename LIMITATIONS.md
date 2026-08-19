# Limitations

What was cut under the time box, and what I would do differently.

- **Amount anomalies are guarded in one direction only.** After the measurement caught a
  recurring counterparty at ten times its usual amount auto-approving (synthetic s-90005), the
  triage derivation gained AMOUNT_OUTSIDE_PATTERN: |amount| more than twice the counterparty's own
  historical maximum floors at accountant-review. Amounts *below* the pattern (a 25k salary
  against a 42k pattern, s-90003) still pass, and seasonal spreads (electricity) get no special
  treatment — a proper band per counterparty needs more history than 6 rows.
- **The Norwegian checks are heuristics, not language understanding.** An English-stopword list,
  an amount substring, a month name. A fluent but factually wrong question passes; a correct
  question phrased unusually can be sent back. A second model as language judge was cut as
  overbuilding at this scale.
- **Evidence grounding is shallow.** The cross-checks verify claimed history support against tool
  results (counts, emptiness), but `history_evidence` prose is only regex-checked — a fabricated
  detail inside otherwise-consistent evidence survives.
- **One endpoint class.** `response_format: json_schema` is always sent; an endpoint that rejects
  it fails the run rather than degrading to json-mode or prose extraction (the extraction path
  exists and is tested, but there is no capability ladder to route to it). Multi-model comparison
  in one eval run (`EVAL_MODELS`) was also cut.
- **No response cache.** Every eval run pays full price. Deliberate: a stale cache after a
  guidance edit makes a domain change look like a no-op, and at 63 rows the run is cheap.
- **No persistence between runs.** Questions already asked would be asked again next month;
  owner answers do not feed back into history. The production version of this system is mostly
  that feedback loop.
- **Duplicate-payment detection is out of scope.** Two identical invoices in one batch would both
  classify cleanly.
- **The gold labels were authored by the builder.** Mitigated — not eliminated — by keeping the 10
  shipped labels verbatim, reporting every rate split by label source, and marking genuinely
  arguable rows `contested` so divergences there read as data points rather than defects.
- **Meals policy is a judgement call.** Client entertainment (`Kundemiddag`) is routed to the
  owner for attendees; recurring coffee shops auto-approve. Both directions are defensible; the
  gold marks these rows contested and the report shows where the system lands.
