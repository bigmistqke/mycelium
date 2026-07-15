# The experiment protocol — design

**Date:** 2026-07-15
**Decision node:** 378 (`3397a12c-c922-47a8-9aca-5834904dc4f8`)
**Status:** design, **not scheduled to build.** See *Sequencing* — this earns its place at the
second experiment that wants it, not before.

---

## Why

The verify-gate experiment (`packages/v3/experiments/verify-gate/`) worked, but running it
exposed that this repo has no way to run an experiment and stay informed while it runs. Three
concrete failures, all structural rather than bad luck:

- **Serial.** 22 claims, one at a time, each a fresh `claude -p`. ~20 minutes wall-clock with
  the machine mostly idle.
- **Blind.** The run emitted nothing durable. Introspection existed only because `peek.ts` was
  written *reactively*, mid-session, after the blindness became annoying — and even then it
  reads finished artifacts, not the live run.
- **Never concluded.** The last three items hung on a slow `claude -p`, and because the loop was
  serial with a 300s-per-call timeout, one stuck call blocked everything behind it. The run was
  stopped at 19/22 and the finished work was only saved because probes happened to be cached.

The fix is not specific to the verify gate. It is a **convention every experiment can follow** so
that intermediary results are visible, a stop loses nothing, and one command reports any
experiment's state the same way.

## The one idea

Apply the project's recurring shape — **append-only log, derived view** — to experiment runs.

```
events.jsonl   append-only, one line per (item, stage) transition   ← the truth
cache/         each stage's actual output, keyed by item + stage      ← replay + resume
status view    folded from the log, on demand                         ← introspection
```

This is hive's own architecture (git commits are the log, SQLite is the materialized view)
pointed at experiments. It is the sixth place this shape has arrived in mycelium, and it is what
`peek.ts` was already reaching for — except `peek.ts` reads the *artifacts* after the fact, and
the log lets the view show *in-flight* items while the run is still going.

The log is authoritative and never rewritten. Progress, tally, "what is stuck," per-stage timing —
all of it is **computed** from the log, never stored as mutable state that can rot.

---

## Model

An experiment is a set of **items** that each pass through an ordered list of **stages**.

- **verify-gate:** items = 22 claims; stages = `probe` → `run` → `reach`.
- **mutate:** items = mutants; stages = `apply` → `test` → `classify`.
- A generation experiment: items = modules; stages = `propose` → `check`.

The protocol standardizes the loop around items and stages. It says nothing about what a stage
*does* — a stage is just a function.

### On-disk layout

```
packages/v3/experiments/<name>/
  runs/
    <run-id>/
      events.jsonl              # the append-only log
      cache/<item>/<stage>.json # stage outputs — the old probes/ dir, generalized
```

`<run-id>` is supplied by the caller (e.g. a date-stamp passed in), never generated inside the
runner — the runner must stay deterministic and free of clocks so a resumed run targets the same
directory. (`Date.now()` / `Math.random()` are deliberately not used inside it.)

### The event

Small, flat, append-only. One line per transition.

```json
{"ts":"2026-07-15T12:00:00Z","item":"C4","stage":"probe","status":"done","ms":8100,"cache":"cache/C4/probe.json"}
{"ts":"2026-07-15T12:00:03Z","item":"C1","stage":"run","status":"started"}
{"ts":"2026-07-15T12:00:41Z","item":"G1","stage":"reach","status":"done","ms":40,"data":{"verdict":"UNREACHABLE"}}
{"ts":"2026-07-15T12:05:10Z","item":"C6","stage":"probe","status":"failed","reason":"timeout after 300s"}
```

- `status` ∈ `started | done | failed | skipped`.
- Small results go inline in `data`; large results are written to `cache` and referenced by path.
- `ts` is stamped by the appender at write time — the one place a clock is allowed, and it is
  metadata only, never control flow.

The log stays greppable: `grep '"status":"failed"' events.jsonl` is a triage tool with no code.

---

## The runner — what an experiment author writes

A thin helper wraps the item × stage loop. The author supplies items, a key function, and the
stage functions. Nothing else.

```ts
await experiment({
  name: 'verify-gate',
  runId: args.runId,                 // supplied, not generated
  items: loadClaims(),               // 22 claims
  key: c => c.id,                    // 'C4', 'G1', …
  concurrency: 8,                    // items in flight at once
  stageTimeoutMs: { probe: 300_000, run: 120_000, reach: 5_000 },
  stages: {
    probe: (c)             => generateProbe(c),
    run:   (c, { probe })  => runProbe(worktree, probe),
    reach: (c, { probe, run }) => decide(run.outcome, checkReach(probe.reaches, run.covered)),
  },
})
```

Each stage function receives the item and an object of the prior stages' results (fetched from
cache). Its return value is the stage's output: cached, and emitted as a `done` event.

The runner owns the parts that are boring, uniform, and easy to get wrong:

### Resume

On start it replays `events.jsonl` into a map of `(item, stage) → last status`. An `(item, stage)`
that is `done` **and** whose cache file still exists is **skipped** — its result is loaded from
cache and passed downstream. So stopping the verify-gate run at 19/22 and re-running does exactly
C6/C7/C8: the precise failure that bit this session, solved by construction rather than by luck.

Stage-logic changes invalidate downstream results. v1 keeps this manual and explicit: delete the
affected `cache/` entries (or the whole run dir) to force recomputation. A per-stage version tag
that auto-invalidates is deferred — see *Open questions*.

### Parallel and pipelined

Items advance independently, bounded by `concurrency`: C1 can be at `run` while C6 is still at
`probe`. This is per-item pipelining, not a stage barrier — the runner never waits for all items
to finish a stage before any item starts the next. Serial ~20 minutes collapses to a couple, with
**no LLM in the orchestrator** and no dependency on the Workflow harness.

### Timeouts are events, not hangs

Each stage runs under `stageTimeoutMs[stage]`. A stuck `claude -p` emits `failed / timeout` for
that one item and frees its lane; the other items keep moving. A hang can no longer block the
whole run. A failed item simply has no verdict — reported honestly, never silently dropped.

### The gate stays deterministic

Stages are plain functions. `probe` sprinkles in an LLM; `reach` is pure code; the runner treats
them identically. This is the harness reframe (node 348) at the experiment level — protocols
followed deterministically, models called only at the stages that need judgement, and every LLM
stage followed by whatever the next stage is, LLM or not.

---

## Introspection — one command, works mid-run

`experiment status <name> [<run-id>]` folds the log into a view. Because the log is appended as
events happen, it works while the run is still going and shows in-flight items, not only finished
ones:

```
verify-gate · run 2026-07-15-a · 19/22 · elapsed 6m12s

  C4  probe✓ run✓ reach✓   CONFIRMED     (8.1s)
  C1  probe✓ run✓ reach✓   UNREACHABLE   (12s)
  C6  probe⏳ …             in flight     (started 40s ago)
  C7  · · ·                 pending
  ────
  15 confirmed · 4 unreachable · 0 refuted · 0 invalid · 3 pending
```

- `--watch` re-folds as new lines land.
- `tail -f runs/<id>/events.jsonl` is the zero-tooling version.
- This is `peek.ts` promoted to a repo-wide convention: **every** experiment becomes
  introspectable the same way, not just the one that happened to get a bespoke peek script.

The status view is pure derivation. It can be recomputed from the log at any time, which means it
cannot drift from the truth — the same property that makes the decision graph a view over commits.

---

## Retrofitting the verify gate

Almost nothing in the gate changes; the plumbing is rehomed:

| today | under the protocol |
|---|---|
| `run.ts`'s serial `for` loop | one `experiment({...})` call |
| `probes/<id>.json` | `runs/<id>/cache/<item>/probe.json` |
| `peek.ts` | the generic `status` command |
| the answer-key check in `run.ts` | an assertion over the derived view |
| `verdict.ts` (the gate) | **untouched** |

It is the same experiment, made streamable and resumable — and it would finally exercise the
`REFUTED` path and close C6/C7/C8 without a 20-minute blind wait.

---

## What it deliberately is not

Breezy, per the project's own distinction (experiments are cheap and light; code and tests are
heavy and static). No database, no daemon, no web UI, no plugin system. A JSONL appender, a status
folder, and a bounded-parallel runner — on the order of a couple hundred lines. An experiment that
does not want it still runs as a bare script; opting in costs one `experiment({...})` call.

It must be lighter than what it replaces or it is not worth having. A stuck backgrounded
`node run.ts 2>/dev/null` is a low bar, and clearing it is the whole requirement.

---

## Sequencing — why this is not scheduled to build

This protocol is itself a piece of heavy, static infrastructure — exactly the kind of thing
DESIGN.md's closing warning is about (*"beautiful structure that nobody maintains"*), and exactly
the kind of thing the reshape from package to experiment was correcting. Building it now, off one
experiment, would be generalising from a single instance — the mistake the templates section names
(*"two instances before an abstraction"*).

So:

1. **verify-gate is instance one.** Its `run.ts` / `probes/` / `peek.ts` are the concrete shape.
2. **A second experiment that wants the same thing is the trigger.** Plausible candidates:
   mutation-reach (many mutants × apply/test/classify) or a proposition pass over many modules
   (many modules × propose/check). Either has the same item × stage structure and the same need
   for parallel, resumable, introspectable runs.
3. **Only then extract the runner**, with two real instances to abstract over, and retrofit
   verify-gate as the second adopter.

Until instance two exists, this spec is the record of the shape, not a work order.

---

## Open questions

1. **Auto-invalidation of downstream cache when a stage's logic changes.** v1 is manual (delete
   the cache). A per-stage version tag (hash of the stage source, à la v0's signature/implementation
   hashes) would make re-runs correct without hand-deletion, but it is not needed to clear the low
   bar above.
2. **Concurrency and the shared worktree.** The verify gate writes each probe into a single pinned
   hive worktree and runs vitest there. Parallel items need either one worktree per lane or a
   per-item probe path plus isolated coverage dirs (the run-probe code already namespaces by claim
   id, so this is close to free — but it needs checking before parallelism is switched on).
3. **Where the log lives long-term.** JSONL under `runs/` is fine for a solo experiment. If runs
   become something teammates share, this is the same log-distribution question the trace edge
   answered with git — and the answer may again be "commit it," making runs replayable across
   machines the way probes already are.
4. **Relationship to the Workflow harness.** Workflow already provides parallel fan-out, a journal,
   and live progress — but its workers are LLM subagents, which does not fit a gate whose verdict
   must be deterministic. This protocol is the deterministic-orchestrator counterpart. If a future
   experiment's *work* is genuinely LLM fan-out (a proposition pass over a whole codebase), Workflow
   may be the better substrate for that one. The two are not competitors; they fit different
   experiment shapes.
