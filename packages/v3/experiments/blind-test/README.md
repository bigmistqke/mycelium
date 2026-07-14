# Blind test — can a model produce propositions with teeth?

The design in `../../DESIGN.md` rests on one assumption: that a model, asked to decompose a
module into checkable claims, will produce **guards that admit real gaps** rather than plausible
restatements of the happy path. If it can't, the harness has no engine.

This directory is the experiment that tested it.

## Subject

`hive/packages/core/src/lib/event-store.ts` — 729 lines. Event-sourced: git commits are the log,
a SQLite database is the materialized view rebuilt by replaying it. Chosen because it is real,
mature, LLM-built, has crisp invariants (replay determinism, idempotency, log/view consistency),
and its test suite runs in 4.5 seconds.

## Protocol

1. `prompt.txt` — the only instruction given. Asks for propositions (`text` / `guard` / `answer` /
   `verified_by` / `falsified_by`), then gaps and contradictions **with concrete witnesses**.
2. `cold-pass-output.json` — the result. A **separate `claude -p` process**: no session context,
   one prompt, one file path.
3. `hand-pass-locked.md` — an independent pass done by hand, **written and locked before looking
   at the cold output**, including a prediction of what the cold pass would miss.
4. `probes.test.ts` — falsification attempts against hive's real test harness. A **failing** test
   here means the claim is **real**.

## Result

| | |
|---|---|
| cold pass | **29 propositions, 14 gaps, 8 contradictions** |
| overlap with the hand pass | **7 of 8**, usually sharper |
| the locked prediction (*"it will miss the cross-file findings"*) | **wrong** |

The prediction failed for the reason that matters most: the cold pass was given **one file**, and
went and read `add.ts`, `status.ts`, `custom-db.ts` and `nodes.ts` **by itself**. Several of its
best findings were only visible after doing so.

> **You do not convey the graph to the model. You give it an entry point and let it fetch.**

That single observation deleted the entire rendering layer from the design.

## But the gate mattered more than the engine

**22 claims in → 1 confirmed by test, 1 traced to exact lines, 20 unproven.**

The confirmed one: recording a transition on the `confidence` property and then rebuilding from
the log re-materializes it as a **status** transition, because the commit subject is hard-coded to
`status: …`. The node's status becomes the string `"95"`.

And two of the three probes in `probes.test.ts` **passed while testing nothing.** hive's
`replayEvents` branches on `dbExists`, which is permanently `false` under its in-memory test
database — so **all 162 of hive's tests take the full-rebuild path, and the incremental replay
path is never executed.** The suite is green; the path is dead; and that is exactly where the
cold pass's most serious claims live.

Two conclusions, and the second is the important one:

- **The engine works.** A model can produce propositions with teeth.
- **A model that generates 22 plausible claims and no way to sort them is a liability, not a
  tool.** The verify gate is the product.

## Reproducing

```sh
claude -p "$(cat prompt.txt)" > cold-pass-output.json
# then copy probes.test.ts into hive/packages/tests/src/ and run its suite
```

Expect different propositions each run. What should be stable is that the gaps are *real gaps* —
that is the claim under test, not the exact wording.
