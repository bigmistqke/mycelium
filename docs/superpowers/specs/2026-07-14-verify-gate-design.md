# The verify gate — design

**Date:** 2026-07-14
**Decision node:** 369 (with 370, 371)
**Goal node:** 368 — *Build the verify gate*
**Status:** approved, not built

---

## Why

The proposition engine is proven. A cold `claude -p` handed one 729-line module produced 29
propositions, 14 gaps and 8 contradictions, and beat a hand pass done with six hours of context on
the same domain.

It also produced **22 claims and no way to rank one of them.** Exactly one was confirmed by a test.

> **A model that hands you 22 plausible claims and no way to sort them is a liability, not a tool.**

Worse, when three of those claims were probed by hand, **two of the three probes passed while
executing nothing.** The suite was green, the code was never reached, and both claims would have been
scored "refuted" by anything watching only pass/fail.

The gate is what turns the engine's output into something you would run on your own repositories.

---

## Scope

Verify the **22 existing claims** in `packages/v3/experiments/blind-test/cold-pass-output.json`
against **hive**, pinned to a commit.

Not in scope: re-running `propose`, mutation-based reach, any store integration, any CLI beyond what
this needs. Mutation-reach is the next increment and is discussed under *Deliberately deferred*.

The corpus was chosen over a fresh module or a synthetic fixture because **it carries a partial answer
key** (below). That answer key is what lets the gate be tested rather than merely run.

---

## Architecture

Four stages. Three of them are deterministic. `claude -p` is called once per claim and nowhere else.

```
claims.json  (22 claims, already exist)
     │
  probe    claude -p, ONE claim in, one probe out        [LLM, bounded]
     │     → { probe: <vitest file>, reaches: [{file, lines}] }
     │
  run      vitest --coverage in a pinned hive worktree   [no LLM]
     │     → { passed | failed | errored, assertionFailed?, coverage }
     │
  reach    did the declared lines execute?               [no LLM]  ← the gate
     │
  report   four verdicts + the number                    [no LLM]
```

The `probe` call is bounded in the way the design demands. *"Write the single probe that fails if this
claim is true, and declare the lines it touches"* has one right answer and no room to pad. The model
is never asked to "write tests for `event-store.ts`" — the unbounded question is never posed.

---

## Reach

This is the product. A probe can lie in **both** directions, and reach is a different check in each.

| probe outcome | naive reading | the lie | what reach demands |
|---|---|---|---|
| **fails** | claim confirmed | it threw in bootstrap and never reached its assertion | the failure is an **assertion** failure, **and** the declared lines executed |
| **passes** | claim refuted | it executed nothing | the declared lines executed |

> **Reach is a necessary condition on every verdict, not a filter applied at the end.**

### Distinguishing an assertion failure from a bootstrap throw

`CONFIRMED` requires the probe to have failed **on its assertion**. Vitest's JSON reporter gives each
test's `failureMessages`; an `expect()` failure surfaces as an `AssertionError` with `expected` and
`actual`, while a bootstrap throw surfaces as whatever the code threw (a `TypeError`, an fs error, an
import failure). The gate keys on that: **`AssertionError` → the probe reached its claim and the claim
held up. Anything else → `INVALID`.**

This is the check that stops "my setup threw" from being reported as "I found a bug."

### Where the reach target comes from

The claims carry a `witness` and `why_it_matters` — but **no file:line**, and coverage-reach needs
lines.

So the probe call emits them: `{ probe, reaches: [{file, lines}] }`. That is a **falsifiable
declaration**, checked deterministically against v8 coverage.

This is the same confabulation guard `trace/`'s `commit-msg` hook already uses: an agent asked to cite
*will* cite, so you make a false citation expensive to construct by checking the declaration against
what actually happened. Second independent application of the trick — mild evidence it generalises.

---

## The four verdicts

| verdict | condition | meaning |
|---|---|---|
| **CONFIRMED** | probe failed **on its assertion**, and reached the code | the claim is real |
| **REFUTED** | probe passed, and reached the code | the claim is false |
| **UNREACHABLE** | probe ran; declared lines never executed | **a finding, not an error** |
| **INVALID** | probe didn't compile, or errored outside its assertion | **the gate failed, not the claim** |

**UNREACHABLE is a finding.** hive's test context uses an in-memory fs, so
`ctx.fs.existsSync(getDbPath(...))` is permanently `false` and every one of its 162 tests takes the
full-rebuild branch. The incremental replay path has never executed — not once. Claims about that path
*cannot* execute their own code, and the honest report of that is not "we failed" but "this code is
unreachable under your test double."

That is open question #6 (test-double divergence) promoted from a caveat to an output category.

**Binary survived/died would have scored the two lying probes as REFUTED, silently** — which is the
exact failure this gate exists to catch. The verdict set is not four-way for tidiness; it is four-way
because two of those cells were populated by real mistakes made last session.

---

## Components

A small TypeScript package at `packages/v3/gate/`, run with node's native type stripping — no build
step, matching how `experiments/*.ts` already run.

| module | job |
|---|---|
| `claims.ts` | parse `cold-pass-output.json` into a flat `Claim[]`. **Must strip the ` ```json ` fences the cold pass actually emitted** — the file is not valid JSON as it stands. Propositions, gaps and contradictions all normalize to one shape. Ids: propositions keep the `P1…Pn` the cold pass assigned; gaps and contradictions have none, so they get `G1…Gn` and `C1…Cn` **by array index**, which is stable because the corpus file is frozen. |
| `worktree.ts` | `git worktree add` on `../hive` at a pinned SHA; `pnpm install`; `pnpm build:core`; add `@vitest/coverage-v8`. Cached under `.mycelium/worktrees/hive-<sha>` and reused across runs — the install is the slow part and it pays once. |
| `probe.ts` | one `claude -p` per claim → `{ probe, reaches }`. Raw output written to `probes/<claim-id>.json` and reused on re-run, so a second pass costs no tokens and every verdict stays replayable against the exact probe that produced it. |
| `run.ts` | write the probe into the worktree; run vitest **on that file alone**, under a gate-supplied config; capture the JSON reporter output and `coverage-final.json`. |
| `reach.ts` | did the declared lines execute? |
| `report.ts` | verdicts, and the number. |

**One vitest invocation per probe**, with a gate-written config whose `include` is only that probe.
Two reasons: coverage is attributable to *that* probe and nothing else, and a probe that crashes
cannot taint the other 21. hive's own 162 tests are never run.

### The source-map dependency

hive's tests import the **built** `@hive/core` (`"exports": {".": "./dist/index.js"}`), so v8 coverage
sees `dist/lib/event-store.js`. Core compiles with `sourceMap: true` and the `.js.map` files exist, so
coverage should remap to `src/lib/event-store.ts` and line-based reach targets should land on source
lines.

**This is assumed, not proven, and everything rests on it.** See *Risks*.

---

## Failure handling

The governing distinction: **a claim failing is data; the gate failing is a bug.**

| failure | response |
|---|---|
| `claude -p` returns prose or fenced JSON | strip fences, retry once, then `INVALID` |
| probe doesn't typecheck | feed `tsc`'s error back for **one** repair attempt, then `INVALID` |
| probe times out | `INVALID` |
| worktree / install / build fails | **abort the entire run** |

The repair attempt is not the model judging itself: the compiler is the gate, and the model is told
only what it broke.

Aborting on infrastructure failure is deliberate. Converting a failed `pnpm install` into 22 `INVALID`
verdicts would be the gate lying about itself, which is the one thing it may never do.

---

## How the gate is verified

Three claims have known ground truth from the blind-test session:

| claim | must come back | why |
|---|---|---|
| a confidence transition re-materializes as a **status** on rebuild | **CONFIRMED** | a real failing test proved it |
| a status change is dropped on an incremental sync | **UNREACHABLE** | its probe passed while executing nothing |
| an `add` against a cold db truncates the view | **UNREACHABLE** | same |

> **If the gate reports REFUTED for either of the last two, the gate is broken.** It has reproduced
> last session's exact mistake, and the reach check has failed at the one job it exists for.

This is a real regression test, not a ceremonial one: **the naive design fails it.**

The other 19 claims are discovery. The headline output is the verdict distribution across all 22.
*The success criterion is a number.*

A high `INVALID` count is a verdict on the **probe prompt**, not on the design — it means the model
cannot write a compiling probe from a claim, which is a fixable prompt problem and should be reported
as such rather than buried.

---

## Risks

1. **Source-map remapping is assumed.** If v8 coverage attributes to `dist/` despite the maps, every
   line-based reach target is meaningless and the whole gate is decorative.
   **Mitigation: prove it on one hand-written probe before generating any of the 22.** First task,
   cheap to check, and it invalidates the design if it fails.

2. **`claude -p` is nondeterministic.** Two runs give two probes and possibly two verdicts. Mitigated
   by caching raw probe output per claim, so a verdict is always replayable against the probe that
   produced it — but the underlying variance is real and unmeasured.

3. **Reach proves contact, not dependence.** A probe can execute a line and still assert nothing about
   it. Coverage is a **necessary** condition; it is not sufficient. Mutation-reach is the sufficiency
   check and it is not in this scope.

4. **The gate cannot tell you a claim is important.** It sorts real from unreal. Ranking what survives
   still needs the decisions, which is what `trace/` exists for and is not wired in here.

---

## Deliberately deferred

**Mutation-reach.** Break the lines the claim names, re-run the probe, require the verdict to flip.
This proves the probe is *sensitive* to the code, not merely that it touched it — the sufficiency
check that coverage cannot give. It needs mutation operators over TS source and one extra test run per
mutant, and `experiments/mutate.ts` is the seed.

It is second, not first, because coverage-reach demonstrably catches **both** real lies from the
session: hive's dead incremental path shows as zero coverage, and a probe that blows up in bootstrap
shows as zero coverage. Build the check the evidence demands, then the one theory demands.
