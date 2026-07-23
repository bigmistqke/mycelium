# Handoff — 2026-07-14

Written at the end of a long session. Read this, then `DESIGN.md`.

**Start here:** `trace/` is the only thing that exists. Everything else is design.

---

## What shipped

**`packages/v3/trace/`** — the code↔intent edge. A `commit-msg` hook and a bash CLI.

```sh
trace why  <file>:<line>    a line of code → the decisions behind it
trace code <uuid|id>        a decision → every commit that exists because of it
trace gaps                  what fraction of commits are traceable
trace backfill              recover citations deciduous already knows (git notes, no rewrite)
```

The hook **verifies rather than trusts**: rejects a missing trailer, rejects a UUID that resolves to
nothing, and rejects a real node whose declared files don't overlap the commit's changed files. That
last one is the point — an agent asked to cite something *will* cite something, and the file check is
what makes a false citation expensive to construct.

**This repo went from 0% to 54% traceable.** The remaining 46% has no record anywhere and would have
to be proposed and verified.

Cite the **UUID** (`change_id`), never the integer id. Commit messages are immutable; the integer is
a display alias that wouldn't survive a move to hive.

---

## What was PROVEN (evidence, not argument)

| claim | evidence |
|---|---|
| a cold `claude -p` produces propositions with **teeth** | 29 propositions / 14 gaps / 8 contradictions on hive's `event-store.ts`. Beat a hand pass done with 6h of context on the same domain. |
| **the gate matters more than the engine** | 22 claims in → **1** confirmed by test, 1 traced, 20 unproven |
| mutation testing finds real noise | v2's 5 hand-written `max` tests → **2 load-bearing**. One (`{4,4}→4`) cannot fail at all. |
| gap-checking derives edge cases nobody recalled | 3 naive `clamp` propositions → **10 contradictions, all `min > max`**, found without anyone knowing that edge existed |
| **a probe can lie** | 2 of 3 probes passed *while testing nothing*. hive's `dbExists` is permanently false under its in-memory test db, so **all 162 of its tests take one path and the other has never executed.** |

Artifacts: `experiments/mutate.ts`, `experiments/exhaustive.ts`, `experiments/blind-test/`.

---

## What was CORRECTED (I was wrong, four times)

1. **"Let the agent fetch"** — too broad. Code retrieval is self-guiding (imports, call sites) so the
   agent fetches it fine. **Intent is not in the repo, so it must be supplied.** You cannot grep for a
   decision you don't know exists. That's what `trace` is for.
2. **"The four packages were layers all along"** — retrofitted narrative. They are *explorations*.
   Some parts are reusable. That is a smaller claim, and v3 is an exploration too.
3. **"Squashing hive destroys data"** — it's a `.map()`, not a design constraint. `parseGitLog` reads
   one event per commit. Every UUID survives a squash; the reader just never looks for a second one.
4. **"hive's outcome node made a false claim"** — it said *rebase-safe*, and it **is** rebase-safe. I
   expanded it to "history-rewrite-safe" and went hunting for evidence it was wrong.

**The pattern is the finding.** Four tidy stories, four corrections, and **the user caught every one** —
not a test, not a solver, not the design. That is the exact failure mode (plausible, confident,
unverified) that this whole design exists to catch, running live in the agent designing it. It is the
strongest argument in the session that **the gate must not be a model.**

---

## The design as it now stands

**The inversion (read `DESIGN.md`'s opening):**

> **mycelium is the agent. `claude -p` is a function it calls.**

Fewer tools that require discipline from a model; more protocols followed deterministically with
models called at the judgement points. Evidence: `CLAUDE.md` mandates commit-linking *in bold* and an
agent complied **52%** of the time. Hooks were obeyed **100%**. And a cold, bounded call **beat** a
long-running agent holding six hours of context.

**The model:** decisions decompose into propositions (`text` / `guard` / `answer` / `verified_by:
type | test | review | none`), recursive, one test per *leaf*. To split a proposition you must name
the failure scenario only the child catches.

**Three checks, none of them a model:** gaps + contradictions (solver over guards), redundancy +
vacuity (mutation), status (derived — never declared).

**Templates are *scale*, not taxonomy.** Everything bottoms out in functions. But descending a scale
requires **frame conditions** — the structural claims that hold a composition together and live in
none of its parts. *Unit tests without frame conditions are unsound decomposition.*

**The fractal — five times in one session, each time as the answer to a hard problem:**

```
hive         git commits are the log     →  SQLite is the view
tests-as-spec  decisions are the log     →  tests are the view
trace        commit messages are the log →  the graph is the view
compaction   raw thoughts are the log    →  the summary is the view
branches     scratch branches are the log→  the main graph is the view
```

**Append-only truth, derived view, all the way down.** Name it once instead of re-deriving it.

**Agents write to scratch branches; the main graph is DERIVED from them, not curated.** hive's
`hive-*` branch model was built for teammates and never used (solo author) — it fits *agents*
exactly. Because the main graph is derived, **it can be recomputed, and a thing that can be
regenerated cannot rot.** That is the first design here that doesn't depend on someone staying
disciplined.

---

## What to do next (ranked)

### 1. Build the verify gate. It IS the product.

The engine is proven. A model that hands you 22 plausible claims and no way to sort them is a
liability, not a tool.

```
propose   claude -p, bounded, one module   →  gaps + concrete witnesses     [PROVEN]
probe     generate a test that FAILS if the claim is true, run it           [BUILD]
reach     assert the probe actually executed the code it claims to test     [BUILD]
report    only what survived                                                 [BUILD]
```

**`reach` is not optional.** Two of three probes tonight passed while executing nothing.

### 2. Fix hive: let a commit carry N events.

`parseGitLog` does `commits.map(parseCommit)` — a 1:1 shape that was *mandatory* when the id **was**
the commit hash, and became *arbitrary* the moment `e912e55` moved identity into the body. **The
parser never caught up with its own migration.** Lifting it unlocks squash, **batching** (a harness
emitting 50 intermediate thoughts writes *one* commit), and cheap high-volume logging — the premise
of the whole scratch-branch design.

### 3. The query substrate (v0).

Small agents are only viable if they can **ask instead of read**. Reading is `O(agents × files)` —
fifty agents each rebuilding the same comprehension and throwing it away. A graph is a **cache of
comprehension**: pay `O(files)` once, query N times. That is v0's decision **#20, "Query interface
design"**, written in January for the package everyone wrote off.

**But:** "v0 is the foundation" commits you to v0's *implementation*, built to answer a different
question (#192: topology analyzer). What it really offers is a **proven idea** plus **reusable parts**
(side-effect tracking, descriptions, change detection). Reuse is a decision on the merits.

**Where the graph earns its keep — empirically, from the blind test:** the cold agent handled every
*local* question by reading, and failed on exactly the *non-local* one (it produced 22 gaps and could
not rank one of them, because it had no decisions to compare against). **Read for local. Query for
global and for intent.**

---

## Open findings in other repos (verified, unfixed)

**pulse** — four findings written to `docs/follow-ups.md`, committed as `691ab4d`. All confirmed by
probe against HEAD `401de25`. The serious one: **speculative writes propagate exactly one hop** —
`A → B → C`, write `A`, read `C` → stale. A glitch in the speculation engine.

**hive** — one **confirmed** data-corruption bug: a `confidence` transition re-materializes as a
**status** on rebuild; the node's status becomes the string `"95"`. And its incremental replay path
has **never executed** — which is where roughly 20 further unverified claims live. Raw output:
`experiments/blind-test/cold-pass-output.json`. **Nothing has been reported to hive.**

---

## Risks that still stand

1. **The human must review.** Relocated (to the end, over *verified* findings), not removed. The
   standing counter-evidence is that no decision status was flipped in five months.
2. **Unproposed propositions are undetectable.** A gap in the *guards* is computable. A decision you
   never thought to make is not.
3. **Procedural knowledge has no home.** Runbooks, debugging lore. The model is declarative.
4. **The harness cannot tell you a decision was *bad*.** All three checks are consistency checks.
   Green means *coherent*, never *wise*. A fully-verified disaster reports green.
5. **Test-double divergence.** A proposition can be covered, non-redundant, and passing while its
   code is unreachable in production terms.

---

## State

- mycelium: **clean, ~35 commits ahead of origin, not pushed.** 365 decision nodes, no orphans.
- `trace gaps`: **54%**.
- Scratch artifacts (mutation harnesses, worktrees, the answer key) are in the session scratchpad and
  will be lost. Everything that mattered is committed under `experiments/`.

## The one sentence

> **Everything needed to know this was already in the graph. There was just no way to ask.**
