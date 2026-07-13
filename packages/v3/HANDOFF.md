# v3 Handoff: ADR ↔ Knowledge Graph ↔ Test Surface

> **SUPERSEDED by [DESIGN.md](./DESIGN.md).** Read that first.
>
> This document's *repo survey* (what v0/v1/v2/hive/deciduous are, and the inherited v2 tension)
> is still accurate and useful. Its *proposed model* is obsolete: it argued for a citation edge
> (`test → proves → node`) linking tests to decisions as separate artifacts. That idea was
> replaced by **composition** — decisions decompose into propositions, and the test surface *is*
> the leaf set, not a thing linked to it. See DESIGN.md.

**Status:** design not started. This document exists so a fresh session can pick the thread up cold.
**Written:** 2026-07-13. Nothing in `packages/v3/` has been built yet.

---

## The idea, in the user's words

> there are ADRs -> architectural decisions that are made -> there is a knowledge graph with these ADRs as a sort of tag, coming together of knowledge -> tests become the materialized spec -> how to make this clear relation between ADR, knowledge graph and test surface -> i have been playing around with TDD, but i often found to rely purely on an llm in an unstructured way leads to a lot of redundant and unfocused tests

Two things are bundled here. Keep them separate.

1. **A structural claim.** ADRs, a knowledge graph, and a test suite are three views of one thing, and the relation between them should be explicit rather than implied.
2. **A concrete pain.** Unstructured LLM-driven TDD produces redundant, unfocused tests. This is the problem that would justify the structure.

The pain is the thing to solve. The structure is the hypothesis about how.

---

## The insight worth keeping

Hive (see below) is event-sourced: **git commits are the event log, SQLite is the materialized view.** The phrase "tests become the materialized spec" is that same architecture one level up — **decisions are the log, tests are the view.**

That reframing makes the redundant-test problem tractable. LLM TDD produces noise because **a test has no reason to exist**. Nothing records what it materializes. If every test must cite the node it proves, three properties become computable instead of a matter of taste:

- **coverage** — decisions with zero tests
- **redundancy** — two tests citing the same node without proving distinct properties
- **deletability** — a test citing nothing is noise by definition

That citation edge — `test → proves → node` — is the whole proposal in one line. Everything else is packaging.

**Caveat, stated up front:** this has not been tested. It's plausible, not validated. It's entirely possible that forcing a citation just moves the noise (the LLM writes three tests citing the same node and invents three "distinct properties" to justify them). The first real job is to find out.

---

## What already exists

Three repos, and the pieces of this idea are scattered across all of them.

### mycelium (this repo) — the intent graph

- `packages/v0` — TypeScript static analysis (ts-morph) into a SQLite semantic graph. Code → graph. Most built-out: real CLI, Vite client viewer, community detection, tests.
- `packages/v1` — graph → WAT scaffolding. Proven skeleton, deliberately abandoned. Emits `;; TODO: implementation` stubs.
- `packages/v2` — **the live edge.** Full gradient: Vision → Architecture → Component → Function → Dataflow → AST, one graph, typed cross-layer edges (`motivates`, `contains`, `exposes`, `implemented_by`, `compiles_to`). The dataflow→WAT compiler genuinely works — `npx tsx packages/v2/src/cli.ts packages/v2/examples/02_calculator.json` emits real multi-value WAT, and there's a Vite runner that takes dataflow → WAT → WASM and executes the tests.

**v2 already did half of this.** Decision-graph node #291:

> Verification via mocking: tests live at function layer (last described layer). Lower layers (dataflow, AST) inherit tests through `implemented_by` edges. Higher layers are organizational, no executable tests. **Tests ARE the intent, expressed as examples.**

And `packages/v2/examples/00_max.json` really does carry a `tests` array on the function node. So "tests attached to graph nodes" is not speculative — it's running code. What's missing is the *decision* layer above it, and any notion of redundancy.

Note: `packages/v2/README.md` is stale — it says "Hand-written JSON exploration. No tooling yet," which stopped being true several commits ago.

### hive (`../hive`, github.com/bigmistqke/hive) — the ADR store

Git-native decision tracking, inspired by deciduous. Mature: event-sourced, 162 passing tests, orphan `hive-*` branches as the event log, `.hive/db.sqlite` as the materialized view.

It already has most of the ADR vocabulary this idea needs:

- `-t/--topic` — **this is the "sort of tag" from the user's framing**
- node types: `goal`, `decision`, `option`, `action`, `outcome`, `observation`
- status lifecycle on task-like nodes: `pending`, `active`, `completed`, `rejected`
- edge types: `depends_on`, `blocks`, `supports`, `contradicts`, `alternative_to`, `leads_to`

What it does **not** have: any link to code, and any link to tests. "Staleness detection" in recent commits is only SQLite-vs-git-HEAD cache invalidation — **not** ADR drift. Don't be misled by the name (I was, briefly).

### deciduous — the reasoning log actually in use

mycelium's own decision graph, 308 nodes, driven by the mandatory workflow in `CLAUDE.md`. This is the accumulated reasoning of the whole project and the reason v3 lives in this repo rather than a fresh one.

It contains 29 `decision` nodes that are de-facto ADRs — `Mycelium is NOT a new language`, `v1 scope reduction`, `Roundtrip strategy: code edits trigger intent derivation`, etc. **Every one is still status `pending`.** None were ever accepted or superseded. So there is an ADR *log* but no ADR *lifecycle*, which is itself a finding: the tooling permitted a status field and the practice never used it. Worth asking why before designing a system that assumes people will maintain more metadata, not less.

---

## The open question (this is where to start)

**Which project owns this — and therefore what is it?**

- **A capability in mycelium.** Model `decision → constrains → node → proven_by → test` in the intent graph, so "materialized spec" is a property of the graph and test focus falls out of the compiler. Direct extension of v2's node #291. But it only ever works inside mycelium's own dataflow-graph format.
- **A general practice, built on hive.** Tests in any repo, any language, cite hive decision nodes; a CLI computes coverage, redundancy, and orphan tests. Works on real code today. Mycelium becomes the first consumer, not the deliverable.

The user's framing ("how to make this clear relation…", "I have been playing around with TDD") leans toward the **second** — it's a working practice, and it wants to operate on code that isn't a mycelium dataflow graph. But this was never settled. **Settle it first.** The two produce completely different first steps.

Whichever is chosen, the design still owes answers to:

1. **Where does the citation live?** In the test file (`test('...', { adr: 42 })`, a comment pragma, a naming convention)? Or outside it, in the graph? In-code is greppable and survives refactors; out-of-code keeps tests clean but drifts.
2. **What exactly does a test cite?** The decision node itself, or a *property* the decision asserts? This is the crux of redundancy. If tests cite decisions, "one decision, five tests" looks redundant but may be legitimate. If decisions enumerate properties and tests cite properties, redundancy becomes exactly "two tests, one property" — crisp, but it demands the decision node carry a property list, which is more authoring burden. **This is the single most important design question.**
3. **Is redundancy computable, or only reviewable?** Optimistic case: property citation makes it a set-comparison. Pessimistic case: it needs a judgment call, and the tool can only surface candidates.
4. **What stops the LLM from gaming the citation?** If "cite a node" is a checkbox, the LLM will check it. The constraint has to bite.

---

## Unresolved tension inherited from v2 — read this before building

Nodes #302–#305 in the deciduous graph are open, and they are a challenge to the whole graph-authoring premise. Having gotten dataflow→WASM working, the user immediately turned on it:

- **#302 Context bloat.** The calculator dataflow JSON is ~180 lines where equivalent code is ~15. The AI re-reads the whole graph every turn.
- **#303 Training mismatch.** LLMs have read billions of lines of `if`/`else` and almost no dataflow graphs. Asking an AI to work in graphs may fight its training rather than leverage it. **The AI might simply perform worse.**
- **#304 Verb interface.** Possible escape: the AI issues commands (`add_node()`, `wire()`, `delete()`) instead of reading/writing full JSON. Small commands, natural language, no context dump.
- **#305 Structure-native AI.** Other escape: accept that graphs want GNNs, program synthesis, or SMT ("given the tests, *find* the wiring") rather than an LLM.
- **#300** — the dataflow JSON is serialization, not an authoring format; the real interface is a **visual whiteboard** (Unreal Blueprints, Max/MSP, circuit schematics as precedent).

**Why this matters for v3.** The ADR↔test idea is a *lighter* bet than v2's: citations are small, textual, and greppable, so it mostly sidesteps #302 and #303 rather than confronting them. That's an argument in its favour. But it's also worth being honest that v3 does not *resolve* the v2 tension — it routes around it. If v3 works, the question of whether AI can author graphs at all is still open and still unanswered.

---

## State of the repo, as of this handoff

- Branch `main`, **8 unpushed commits**.
- Working tree carries only deciduous sync output (`docs/graph-data.json`, `docs/git-history.json`) and `.claude/settings.local.json`. Nothing substantive uncommitted.
- `packages/v3/` contains only this document.

## Suggested first moves

1. **Answer the ownership question** (mycelium capability vs hive practice). Everything else is downstream.
2. **Then answer design question #2** — cite decisions, or cite properties? Do this on paper, with a real example, before writing any code.
3. **Find a real test case.** The v0 test suite is the honest candidate: it's real, it's LLM-written, and it's the kind of code where "is this test redundant?" has an actual answer. Try citing its tests by hand and see whether the structure holds up or collapses.
4. Resist building a CLI until (3) has been done manually at least once. The failure mode of this whole project is beautiful structure that nobody maintains — and the 29 permanently-`pending` decision nodes are the standing evidence that it's a real risk.

---

## Process notes

- `CLAUDE.md` in this repo makes decision-graph logging **mandatory and real-time**. Log before acting, link every node to a parent, capture verbatim user prompts on goal nodes. Root `goal` nodes are the only valid orphans.
- Run `/recover` (or `deciduous nodes` / `deciduous edges`) at session start.
- Relevant graph nodes for this thread: **#306** (goal), **#307** (this document), **#308** (the hive event-log/materialized-view observation). Prior context: **#291** (tests at function layer), **#300–#305** (the authoring tension).
