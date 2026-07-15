# The verify gate

**Question:** can a deterministic check — no human, no second LLM judging — sort real
findings from plausible-but-false ones that an LLM produced?

The input is fixed: the 22 claims a cold `claude -p` made last session about hive's
`event-store.ts` (`../blind-test/cold-pass-output.json`) — the gaps and contradictions,
not the propositions. Last session those 22 came with no way to rank them and only 1 was
ever verified. That uselessness is the problem this gate fixes.

## The mechanism

```
propose   claude -p, one claim in   →  a probe that FAILS if the claim is true,
                                        plus the source lines it will execute      [LLM, bounded]
run       vitest --coverage         →  passed | assertion-failed | errored          [no LLM]
reach     did the declared lines execute?                                           [no LLM] ← the gate
report    four verdicts                                                             [no LLM]
```

A probe can lie in **both** directions — fail because it threw in setup, or pass because it
ran nothing — so reach is a precondition on every verdict, not a filter at the end.

| verdict | meaning |
|---|---|
| **CONFIRMED** | probe failed on its assertion **and** ran every line it declared — the claim is real |
| **REFUTED** | probe passed and ran every line it declared — the claim is false |
| **UNREACHABLE** | probe ran but its declared code did not execute — untestable here (test-double divergence), a finding not an error |
| **INVALID** | probe didn't compile or threw outside its assertion — the gate failed, not the claim |

## The result (19 of 22; run stopped before C6–C8)

```
15 confirmed · 4 unreachable · 0 refuted · 0 invalid   vs hive@5d52a98
```

- **Answer key held.** Three claims have known outcomes and so test the gate:
  **C4 → CONFIRMED** (a real bug: a `confidence` transition re-materializes as a *status* on
  rebuild), **C1 → UNREACHABLE** and **G1 → UNREACHABLE** (their incremental-replay path is
  dead under hive's in-memory test db). A naive "did any line run" gate reports C1/G1 as
  REFUTED — laundering an untested claim as tested. That is the mistake this gate exists to
  prevent, and it passes.
- **0 INVALID** across 19 probes — every `claude -p` produced a compiling, running probe.
- **15 CONFIRMED** — most of the cold pass's claims are mechanically real bugs in hive, each
  now carrying a failing probe.

The answer key earned its keep by catching **two real bugs in the gate itself** before they
could ship: a mis-read of vitest's assertion-vs-throw output, and a reach rule too weak to
catch C1's lying probe (see `checkReach` in `verdict.ts`).

## Files

| file | role | tested |
|---|---|---|
| `verdict.ts` | the product, pure: `parseCoverage` / `checkReach` / `decide` | `verdict.test.ts` |
| `run-probe.ts` | run one probe in the worktree, classify the outcome | `classify.test.ts` |
| `claims.ts` | parse the frozen corpus (strips its ```json fence) | — |
| `worktree.ts` | pinned, cached hive worktree with coverage | — |
| `probe.ts` | one bounded `claude -p` per claim, cached to `probes/` | — |
| `prompt.md` | the probe prompt (inlines the numbered source) | — |
| `run.ts` | wire it together, print the distribution, assert the answer key | it IS the regression |
| `peek.ts` | recompute verdicts from on-disk artifacts, no re-run | — |

## Run it

```sh
node run.ts            # all 22 (generates probes, cached after first run)
node run.ts C4 C1 G1   # just the answer key
node peek.ts           # recompute the tally from artifacts — watch a run in flight
node --test verdict.test.ts classify.test.ts   # the gate's own tests, zero deps
```

The pinned hive worktree lives under `.mycelium/worktrees/` (gitignored). The generated
probes are committed under `probes/` so every verdict stays replayable against the probe
that produced it — `claude -p` is not deterministic.

## What is deferred

**Coverage proves the probe reached its code; it does not prove the probe *depends* on that
code** — a necessary condition, not sufficient. The sufficiency check is mutation-reach:
break the declared lines, re-run the probe, require the verdict to flip. Seed:
`../mutate.ts`. Not built here.
