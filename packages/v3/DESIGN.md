# v3: A harness for intent-driven TDD

**Status:** design. Nothing built yet.
**Date:** 2026-07-13
**Supersedes:** the citation-edge proposal in `HANDOFF.md` (kept for its repo survey; the model there is obsolete).

---

## The problem

> "i have been playing around with TDD, but i often found to rely purely on an llm in an unstructured way leads to a lot of redundant and unfocused tests"

This is not a prompting problem and it is not the model being careless. It is structural:

**Asked an unbounded question, a generator fills the space.** "Write tests for `clamp`" has no upper bound — the set of plausible tests is infinite, so the model produces plausible tests until it feels done. Nothing in the task says when to stop, so nothing stops.

The fix is not a better prompt. It is to never ask the unbounded question.

## The measurement

Before designing anything we measured the problem on real code — the five hand-written tests for `max` in `packages/v2/examples/00_max.json`, compiled through the real dataflow→WAT compiler and run as real WASM, against seven mutants of the graph.

```
  mutant                          T1  T2  T3  T4  T5      (x = test catches it)
  --------------------------------------------------
  gt_s→gt_u (unsigned compare)     .   .   .   .   x
  gt_s→ge_s (non-strict)           .   .   .   .   .      ← equivalent mutant
  gt_s→lt_s (reversed)             x   x   .   x   x
  always return a                  x   .   .   .   .
  always return b                  .   x   .   x   x
  swap true/false branches         x   x   .   x   x

  T1 {a: 3, b: 5}→ 5   LOAD-BEARING — uniquely catches "always return a"
  T2 {a: 7, b: 2}→ 7   REDUNDANT    — subsumed by T5
  T3 {a: 4, b: 4}→ 4   VACUOUS      — kills nothing; cannot fail
  T4 {a:-3, b:-7}→-3   REDUNDANT    — subsumed by T5
  T5 {a: 0, b:-1}→ 0   LOAD-BEARING — uniquely catches unsigned-compare
```

**`T1 + T5` kill every mutant the full suite kills. Two tests of five do the work — 60% noise.**

Three things worth internalising, because they shape the whole design:

1. **T3 cannot fail.** When `a == b`, every implementation that returns either input passes. The "responsible edge case" is unfalsifiable.
2. **T4 is the seductive one.** `{-3, -7}` *looks* like it covers negative numbers. It doesn't: under unsigned comparison `-3 > -7` still holds, so it sails straight through the bug it appears to guard. Only `{0, -1}` crosses zero and actually catches signedness.
3. **The noise is the plausible-looking part.** This is why "just review the tests more carefully" does not work.

Script: `scratchpad/mutate.ts` (see git history of this doc for the version used).

---

## The shape: an hourglass

```
   EVIDENCE  ─┬─ observation ──── passive: noticed, read, prior art       142 nodes today
              └─ experiment ───── active: action → outcome. may fail.      17 → 49 nodes
                      ↓
              CONVERGENCE ─────── options weighed, alternatives rejected    48 nodes
                      ↓
        ═══════════════════════════════════════════
              DECISION + PROPOSITIONS              THE WAIST                30 nodes
        ═══════════════════════════════════════════
                      ↓
              TEST SURFACE ────── one test per leaf proposition
                      ↓
                    CODE
```

Wide at the top (evidence is cheap, accumulate freely). **Narrow in the middle** (commitments are expensive and human-reviewed). Wide again at the bottom (tests and code are generated).

**Unstructured LLM TDD goes `prompt → tests` directly.** Wide to wide, no waist. Nothing narrows, so nothing bounds. That is the entire bug.

The node counts above are from mycelium's own deciduous graph. The hourglass is already there in the data — 142 observations to 30 decisions — it just never crystallised into anything a test could hang from.

### The two evidence lanes

**Observations** are passive: prior art, things noticed. **Experiments** are active: they ask a question, they run, and *they are allowed to fail* — failing is a result, not a bug.

These have opposite lifecycles, and conflating them is a second source of test noise:

| | Test | Experiment |
|---|---|---|
| purpose | proves a commitment | asks a question |
| may fail? | no — failure is a bug | yes — failure is a result |
| lifetime | as long as its decision | until answered |

Ask an LLM for "tests" and it writes both kinds — genuine commitments *and* exploratory probes ("what if I pass a negative? an empty array? a string?") — and they all land in the same suite with the same permanence. **Much of what feels like an unfocused suite is fossilised experiments** that answered their question months ago and were never allowed to die.

v0, v1 and v2 are each an experiment at the largest scale. v1's result was "dead end", which is a perfectly good outcome.

### Experiments do not promote directly to tests

If they could, they would punch a hole straight through the waist and we would be back to unbounded generation. Promotion goes *through* it:

```
experiment → outcome → observation → proposition → test
                                     └─ usually a new proposition on an EXISTING decision,
                                        not a whole new ADR. The waist entry stays cheap.
```

Two things promote, and they travel separately:

- **The evidence** flows through the waist and must earn a proposition.
- **The code** gets adopted — the experiment already contains a runnable body exercising exactly that case, so when a proposition needs a test, it takes the experiment's body.

So experiments are never wasted work: **the code survives if it earns a proposition, and dies if it doesn't.** That disposal mechanism is what current practice completely lacks — nothing is ever allowed to die, so suites only accrete.

Failed experiments have a job too: they are the evidence that *rejects an option*.

---

## The model

A **decision** is not prose. It is composed of **propositions**.

```
proposition:
  text:         human-readable claim
  guard:        predicate over the input domain      ← required when verified_by: test
  answer:       what the result must be
  verified_by:  type | test | review | none
  children:     [proposition]                        ← recursive; depth = resolution
```

### A guard is a type the language can't express

`clamp(value: i32, min: i32, max: i32): i32` **is a lie.** It claims any three integers are acceptable. The real signature is `clamp(value, min, max) where min <= max`.

The type system permits nonsense, so the nonsense must be either handled or excluded — and *"handled or excluded"* is a decision, which is exactly why `min > max` surfaced at the waist rather than in the compiler.

**The guard is the residue: the part of the contract the type system could not hold.** This is refinement types (`{x: Int | x > 0}`), already catalogued in `PRIOR_ART.md`.

### The modes are ranked, not peers

| mode | proves the claim for… | when |
|---|---|---|
| `type` | **all inputs, all call sites**, statically, forever | compile time |
| `test` | the inputs you thought of | test run |
| `review` | whatever a human noticed | sometimes |
| `none` | nothing | never |

**A test checks the call sites you imagined. A type checks the ones you didn't.** So:

> **Lift into the type system whatever you can. Guard only the residue.**

A proposition promoted from `test` to `type` is a strict improvement: it converts a test you must maintain into a check you get free at every call site forever. The harness should *notice liftable guards and suggest the promotion*.

**solid-three already does this by instinct.** `fix(types): make the plugins prop of withCanvas's Canvas real, and stop loose plugins swallowing every prop` is a proposition being promoted from `test` to `type` — from *"we hope loose plugins don't swallow props"* to *"the compiler will not permit it."*

### Verification mode replaces declared types

There is no `commitment` / `assumption` / `rationale` enum. Those are *consequences* of how a part is checked, not categories anyone picks:

- a **commitment** is a proposition verified by a **test** (or, better, a **type**)
- an **assumption** is one verified by **review**
- **rationale** is one that honestly admits **none**

Why this rather than a fixed taxonomy: an LLM asked to *classify* will classify, and `assumption` becomes a junk drawer. An LLM asked *"how would you check this?"* has to back a claim. If the honest answer is "you couldn't," it must write `none` — and a decision whose propositions are all `none` is a decision that committed to nothing, which is one query away from being visible. Under a fixed taxonomy the same emptiness hides inside a well-populated `rationale` field and looks like diligence.

`monitor` was considered as a fourth mode and cut: for a library there is nothing to monitor at runtime, and it would have been aspirational. Reintroduce it only if a real use appears.

### Worked example: decision #247, `Mycelium is NOT a new language`

| proposition | verified_by |
|---|---|
| Output is an existing language (WAT/TS/Rust), never a novel surface syntax | `test` |
| No user ever hand-writes mycelium-specific syntax | `review` |
| Developers will adopt a graph tool if the output is a language they know | `review` |
| Intentional Programming failed because a new language was too high a barrier | `none` |

The decomposition *tells you something prose never did*: mycelium's most foundational decision has exactly **one** test-verifiable proposition. Everything else is a bet, a habit, or a story about history. That is an accurate reading of what kind of decision it is.

### Propositions are recursive; tests attach to leaves

A proposition can decompose into sub-propositions. Depth is **resolution** — the spec has zoom levels, exactly as decision #10 anticipated.

> **One test per *leaf* proposition.**

Coverage, redundancy and deletability stay crisp: a leaf with no test; two tests on one leaf; a test on no leaf.

**The trapdoor:** if a proposition can always be split further, an LLM can always manufacture another leaf to justify another test. `expires after 1h` → `expires at exactly 3600s` → `does not expire at 3599s` → … and the noise returns wearing a spec costume, which is *worse*, because now it looks rigorous.

**The guard against it:** to split a proposition you must name **the failure scenario the child catches and its siblings don't** — a concrete change to the system that breaks this one and leaves the others green. If you cannot describe one, the split is fake.

> **You cannot add a test without adding a leaf, and you cannot add a leaf without naming what only it catches.**

Test count becomes a function of the spec's resolution rather than of LLM enthusiasm. Same trick as `verified_by`: never ask the model to *label*, always ask it to *back a claim*. Labels are free to fake; distinguishing scenarios are not.

**Note:** "one test per leaf" is deliberately **not** "the minimal suite." Mutation analysis says two tests suffice for `max`; the leaf decomposition gives three (`b>a→b`, `a>b→a`, `compare-is-signed`) because T5 happens to prove two leaves at once. We take the extra test. The goal was never the smallest suite — it was tests that have a *reason to exist*.

---

## The three deterministic checks

This is what makes the design more than a filing convention. Each check runs **without an LLM** and can reject LLM output.

### 1. Gaps and contradictions — over guards

**A test is a point. A proposition is a region.** You cannot do algebra on points; that is a mathematical property of examples, not a discipline failure. But guards are predicates, and predicates support two questions:

- **gap** — an input satisfying no guard → behaviour never specified
- **contradiction** — an input satisfying two guards that disagree → behaviour specified twice, incompatibly

**Demonstrated.** Given the three propositions an LLM writes for `clamp` on autopilot — with no knowledge of any edge case:

```
P1:  value < min           → min
P2:  value > max           → max
P3:  min ≤ value ≤ max     → value
```

the checker reports **0 gaps, 10 contradictions**, and every contradiction has the shape `min > max`:

```
clamp(value=-1, min=0, max=-2)
    P1 "value below min → returns min" → 0
    P2 "value above max → returns max" → -2
```

The empty-range case was *derived*, not recalled. No one had to already know `clamp` has that edge. Script: `scratchpad/exhaustive.ts` (brute-forced over a small domain for clarity; an SMT solver does this over all of i32 without enumerating).

This is the design's strongest claim, and it is why guards are non-negotiable. **Prose propositions buy you nothing here** — no solver can check "handles edge cases correctly."

#### Every gap has three resolutions, not one

When the checker surfaces a gap, the waist gets a *choice*, and the harness must present all three:

| resolution | what it means | becomes |
|---|---|---|
| **handle it** | define the behaviour (swap / trap / a bound wins) | `verified_by: test` |
| **promise it** | declare `min <= max` a precondition and hope | `verified_by: none` |
| **make it unrepresentable** | take a `Range` constructible only when valid | **`verified_by: type`** |

The third one does not *fill* the gap — **it deletes it.** "Make illegal states unrepresentable" is the strongest available answer, and it is the one a naive checker would never offer.

**But it is not free, and the harness must not be dogmatic about it.** A `Range` type makes `clamp` annoying to call — you can no longer pass `(5, 0, 10)`. Every such lift buys correctness with ergonomic friction, and past a threshold the friction wins and callers route around the API. So the harness's job is to say *"this guard is liftable — here is what the type would cost you"* and let the waist decide. It is a tradeoff, not an automatic answer.

### 2. Redundancy and vacuity — over tests

Mutation testing. A test is **redundant** if every mutant it kills is killed by a sibling; **vacuous** if it kills nothing. This is the check that found T2/T3/T4 in `max`.

Its job is to verify that a claimed leaf split is *real* — that siblings genuinely catch different things. It is **not** the arbiter of suite size.

**Known limitation:** equivalent mutants. `ge_s` is killed by no test in `max`, and that is *correct* — `>` and `>=` give identical results for `max`. Any tool built on this must tolerate them and not report them as coverage gaps.

### 3. Status — over the graph

Decision status is **derived, never declared.**

This started as a correction. It looked like mycelium's 29 `pending` decisions were evidence of metadata rot. They are not: **22 of them are v0 implementation decisions** — executed, then abandoned along with v0. They stayed `pending` because deciduous has no status meaning *"this was right, we did it, and then its exploration ended."* Hive has the same gap. The missing concept is **retirement**.

Composition provides it for free. Three independent death modes:

| mode | signal | example |
|---|---|---|
| **violated** | a `test` proposition's test fails | the code stopped doing what you decided |
| **stale** | a `review` proposition goes false | **every test green, decision invalid.** The mode that silently rots architectures. |
| **retired** | the decision hangs off an abandoned exploration | pure graph reachability |

Mode 3 is the one the existing data already exercises: those 22 v0 decisions did not die from failing tests or broken premises. They died because v0 died. **That was computable the whole time and nothing computed it.**

Nobody maintains a status field. The test surface and the graph *are* the status.

---

## The harness

`claude -p` did not exist when mycelium was written. It does now, which means the pipeline can be *executed* rather than practised.

**A harness is LLM stages separated by deterministic gates.**

```
  propose      claude -p    → propositions + guards               [LLM]
  check        solver       → gaps, contradictions                 [no LLM]  ← blocks
  review       human        → approve / reject / amend             [THE WAIST]
  materialize  claude -p    → one test per leaf                    [LLM, bounded]
  prove        mutation     → redundancy, vacuity                  [no LLM]  ← blocks
  implement    claude -p    → code that passes the tests           [LLM]
  status       reachability → live / violated / stale / retired    [no LLM]
```

Every LLM stage is followed by a stage that can reject its output **without asking an LLM's opinion.** That is the difference between a harness and a prompt. It is also `VISION.md` made executable — *"LLMs reason; tools verify"* was written as a philosophy; this is the program.

**The property that kills the noise:** the LLM is never asked an unbounded question. *"Write tests for clamp"* is unbounded. *"Write the single test that proves `value < min → min`, and nothing else"* is bounded — one right answer, no room to pad. The harness does not **ask** the model to be disciplined; it removes the space in which indiscipline is expressible.

### The human's only required job

**Reviewing propositions is the one step a human cannot delegate.** If the LLM both proposes and approves the decomposition, the redundancy problem has merely moved up a level and we get confident-sounding noise in a nicer format.

This is affordable because of the hourglass: seven propositions can be eyeballed; fifty tests cannot. The design puts the human at the narrow point.

**The bet this rests on:** *the LLM writes the guard, the human checks it.* Reading `value < min → min` and asking "…and what about `min > max`?" is a five-second job. Writing the predicate from scratch is not. Formality is pushed onto the machine, which is tireless about it; judgement stays with the human, who is good at it.

If that bet is wrong — if humans won't even review — the design fails, and it fails the same way Intentional Programming did (decision #247: adoption barrier).

---

## The rendering layer — designed, then deleted

An earlier draft of this document had a whole component here: fisheye views over the graph, a code-shaped serialization distinct from the JSON, cached per-node descriptions with hash-based invalidation. All of it existed to answer #302 (the graph is too verbose for a context window) and #303 (models are bad at graphs, good at code).

**It was cut, because the blind test showed the problem does not exist.**

The cold pass was handed **one file** — `event-store.ts` — and nothing else. It went and read `add.ts`, `status.ts`, `custom-db.ts`, and `nodes.ts` **on its own**, and several of its best findings are cross-file ones that were only visible after doing so.

> **You do not convey the graph to the model. You give it an entry point and let it fetch.**

The agent does its own retrieval, and it retrieves better than any fisheye heuristic we would have hand-tuned, because it knows what it is looking for and we don't. #302 and #303 are not solved by clever rendering. They are solved by not rendering.

**Keep exactly one thing** from the deleted design: the *entry point* must be well chosen. That is a one-line decision, not a subsystem.

This is the single largest simplification the evidence bought, and it is worth stating why it was wrong in the first place: **the design assumed the model was a function to be fed. It is an agent that can go and look.**

---

## How the pieces tie together

| piece | role in v3 |
|---|---|
| **v0** | the code knowledge graph. Decisions **tag regions of it** — "a knowledge graph with ADRs as a sort of tag" is literal. Gives orphan-code detection (code no decision explains) and makes retirement computable (tagged region gone → decision retires). Plus descriptions and change detection = the compaction layer. Also: the domain for the **structure template**. |
| **v1** | **the structure template.** `src/constraints.ts` already validates `must_connect` / `must_not_connect` deterministically over a graph — its own header comment reads *"Deterministic tools, not LLM."* This is a completeness checker for structural propositions, built in January. v1 is not abandoned; its constraint layer is a template. (Its WAT scaffolding still is.) |
| **v2** | the intent gradient (Vision → … → Function → Dataflow → AST). Decisions sit *above* vision in the same continuous structure. Provides the compiler and the WASM test runner the harness is measured against. |
| **hive / deciduous** | the decision store. Hive's event-sourced spine (git commits = log, SQLite = view) is the right long-term home; deciduous holds the validation corpus today. |
| **v3** | the waist, the three checks, the harness, the rendering layer. The missing middle. |

**Note:** "tests become the materialized spec" is hive's own architecture one level up. Hive: git commits are the event log, SQLite is the materialized view. v3: decisions are the log, tests are the view.

---

## The blind test — the design's central risk, retired

Everything above rests on one assumption: **that a model can produce propositions with teeth** — guards that admit real gaps — rather than plausible restatements of the happy path. If it can't, the harness has no engine and no schema saves it.

That was tested, blind, on `hive/packages/core/src/lib/event-store.ts` (729 lines, event-sourced: git commits are the log, SQLite the materialized view).

**Protocol.** A cold `claude -p` — separate process, no session context, one prompt, one file path — was asked for propositions with guards, then for gaps and contradictions with concrete witnesses. Independently, and without looking at its output, a second pass was done by hand and written to a locked file first, including a prediction about what the cold pass would miss.

**Result.**

| | |
|---|---|
| cold pass output | **29 propositions, 14 gaps, 8 contradictions** |
| overlap with the hand pass | **7 of 8** — and usually sharper |
| found that the hand pass missed | several, including the most serious one |
| the locked prediction ("it will miss the cross-file findings") | **wrong** |

One finding is **confirmed by a failing test**: recording a transition on the `confidence` property and then rebuilding from the log re-materializes it as a **status** transition, because the commit subject is hard-coded to `status: …`. The node's status becomes the string `"95"`.

**The engine works. The harness is plumbing.**

### The verify gate earned its place in the same run

22 gaps and contradictions went in. **1 confirmed by test. 1 traced to its exact lines. 20 unproven.**

And more instructive: **two of the three probes written by hand to check the claims were themselves invalid** — they passed while testing nothing (see below). Without a gate that isn't a model, this session would have produced 22 confident "findings" of which most were unverified and some were wrong.

*"LLMs reason; tools verify"* stops being a slogan here. It is a measured result: **the model's output was excellent and still needed rejecting.**

### A blind spot the design did not have: test-double divergence

The two invalid probes failed for one reason. hive's `replayEvents` branches on:

```ts
const dbExists = ctx.fs.existsSync(getDbPath(ctx.gitRoot));
if (!lastSyncHash || !dbExists || force) { /* full rebuild */ }
```

In hive's test context the database is **in-memory**, so no file ever exists at that path. `dbExists` is permanently `false`. **Every one of hive's 162 tests takes the full-rebuild branch. The incremental replay path is never executed — not once.**

The suite is green. The path is dead. And that is precisely where the cold pass's most serious claims live — which is *why* they survived.

This is neither vacuity (a test that cannot fail) nor a coverage gap in the ordinary sense. **The test harness is part of the specified system, and a test double that diverges from production silently deletes a code path from the reachable set.**

> **A frame condition on the fixtures, not the code.**

Nothing in this design accounts for that yet. It should. A proposition can be covered, non-redundant, and green — and still guard code that no test can reach.

---

## Templates are scale, not taxonomy

`value < min` is a predicate over a decidable domain. **"Use JWT cookies with refresh rotation" has no input domain at all.** A function has arguments and a return type; an architectural commitment does not. If guards only work for arithmetic, this design is a toy.

The first instinct is to call these different *kinds* of problem and give each its own machinery. That is wrong. **They are the same problem at different zoom levels**, and decomposed far enough, everything bottoms out in functions:

```
"use JWT cookies with refresh rotation"                  decision
  └── "a refresh token can be used at most once"         protocol scale — a trace invariant
        └── "useRefreshToken(t) where t.used → error"    function scale — an input guard
              └── test
```

A **template is the guard language available at a given depth** — not a plugin, not a type.

| depth | a proposition looks like | domain | checker | status |
|---|---|---|---|---|
| **function** | input predicate → output | typed input space | SMT / enumeration + mutation | demonstrated (`clamp`) |
| **structure** | constraint over the code graph | v0's entity graph | static analysis | **already built** — v1's `must_connect`/`must_not_connect` + v0's graph |
| **protocol** | invariant over traces | state × events | property-based test over traces; or *decomposition* (below) | not built |
| **bet** | a claim about the world | — | human review | trivial (`review` / `none`) |

### The descent is not free: frame conditions

**Local correctness does not compose into global correctness.** Decompose *"a revoked token never becomes valid again"* into two function propositions:

- `revoke(t)` sets `t.revoked = true`
- `validate(t)` returns false when `t.revoked`

Both true. Both tested. Both green. **The invariant still does not hold** — unless nothing *else* in the system can set `t.revoked = false`. That is not a fact about either function; it is a claim about everything that is not them:

> **no function outside `auth/` writes `token.revoked`**

This is a **frame condition**, and it is a *structure* proposition. **Descending a scale is only sound if you also emit the frame conditions that hold the composition together.** They live in none of the parts.

**v0 already computes this.** Its analyzer tracks *"side-effects — reads/writes to shared state"* and *"scope boundaries and crossings."* The thing that makes protocol propositions safely decomposable into function propositions was built in January for another purpose.

### One ladder, not two

If a composite proposition is verified by *its children plus soundness conditions* rather than by a test of its own, it behaves exactly like a v2 layer. And #291 already said so: *"higher layers are organizational, no executable tests; lower layers inherit tests through `implemented_by` edges."*

```
  v2's gradient:   vision → architecture → component → function → dataflow → AST
  v3's waist:      decision → proposition → sub-proposition → leaf → test
```

**These are the same ladder.** One rule at every rung:

> **A leaf is verified by a test. A composite is verified by its children being verified, plus the frame conditions that make their composition sound.**

### This is the test pyramid, stated precisely

A protocol-scale proposition can be verified two ways:

- **Directly** — a property-based test over call sequences. Expensive; catches composition bugs for free.
- **By decomposition** — child function tests **plus structural frame conditions**. Cheap to run; sound *only if the frame conditions are actually checked*.

That is the integration-vs-unit tradeoff as a **choice about where you verify**, rather than folklore about pyramid shapes. And it names the cost of the cheap path: **unit tests without frame conditions are unsound decomposition.** Which is why suites full of green unit tests still ship broken systems.

The three checks survive translation across all depths. *"Is the spec complete and consistent over its domain?"* is meaningful everywhere — only the computation differs. Redundancy likewise. Status derivation does not change at all.

### The payoff grows in the harder templates

Decompose the JWT decision:

| proposition | template | verified_by |
|---|---|---|
| an access token is invalid ≥1h after issue | protocol | `test` |
| a refresh token can be used at most once | protocol | `test` |
| the auth cookie is HttpOnly and Secure | structure | `test` |
| no module outside `auth/` reads the refresh cookie | **structure — a v0 graph query** | `test` |
| JWT is stateless, so no session store | — | `none` |
| we take on a dependency on an external IdP | — | `none` |

Now run the gap check over the protocol propositions. *Is there a trace where a refresh token is used twice, and do the propositions say what happens?*

"Used at most once" says the second use is **not allowed**. It does not say what **happens**. That is a gap — **and the gap is the replay attack.** Filling it forces the actual security decision: reject silently, or revoke the whole token family?

**Refresh-token reuse is JWT's `min > max`.** Derived, not recalled, by the same machinery. For functions an unspecified input is a bug; for protocols an unspecified *trace* is a vulnerability. **The templates where guards are hardest to write are the ones where the gaps are worth the most.**

### Sequencing — two instances before an abstraction

Because templates are depths rather than plugins, there is no plugin system to build. But there is still an abstraction to *find*, and there is currently only **one** working instance of it. Generalising from one instance is how bad abstractions get made.

1. **Build the function depth.** The `clamp` experiment is unchanged; it produces the number.
2. **Then one structure proposition** on mycelium itself, using machinery that already exists — e.g. *"the dataflow layer never references AST nodes"* as a v0 graph query or a v1 `must_not_connect`.
3. **Only then name the interface**, with two real instances to abstract over.
4. **Protocol last** — and note it may need no new machinery at all, if decomposition-plus-frame-conditions turns out to be sufficient. Test that before reaching for a model checker.

**Constraint on the schema:** nothing in the proposition type may assume the domain is an argument list. That is the one thing that would foreclose the upper depths.

---

## Open questions

1. **Which store does the harness read — deciduous or hive?** The validation corpus (311 nodes, the v0-retirement natural experiment) is in **deciduous**. Hive is the better architecture and it's yours. Recommendation: read deciduous first *because that's where the evidence is*, target hive once the model earns its keep.

2. **Will the human actually review?** The entire design rests on it. The standing counter-evidence is that no decision status was flipped in five months. Mitigation is that the LLM writes the guards and review is a five-second judgement — but this is a hypothesis, and it is the one most likely to sink the project.

   **Updated by the blind test:** the review load is worse than assumed. The cold pass produced **22** gaps and contradictions from a **single 729-line module**. Nobody eyeballs 22 claims per module across a codebase. This makes the verify gate load-bearing in a way the original design did not appreciate: **the human must review what survived verification, not what was proposed.** The gate is not an optimisation, it is what makes the human's job finite.

3. **Unproposed propositions are undetectable.** A gap in the *guards* is computable. A decision you never thought to make is not. The solver catches contradictions between what you wrote; nothing catches what you never wrote. This is a real hole with no mechanism behind it — only the human at the waist, who is also working from a cropped view.

6. **Test-double divergence has no mechanism.** A proposition can have a test, be non-redundant, and pass — while the test double makes its code path unreachable in production terms (hive: 162 green tests, incremental replay never executed). The design has no check for "does this test actually reach the code it claims to guard". Probably: assert reachability as part of the verify gate.

4. **Are v2's `tests` arrays actually tests?** They verify *the compiler works*, not that *a decision holds* — i.e. they are experiments. If so, v2 has no test surface yet and v3 would be giving it one for the first time. Do not design as though v2 already got this right.

5. **Do guards generalise past arithmetic?** Partly answered by the templates section: the architecture survives, the domain varies, and two of the four templates already have machinery in this repo. What is *not* answered is whether an LLM can reliably write a **protocol** guard — an invariant over traces is a much harder authoring task than an inequality over integers, and that is precisely the template where the payoff is largest. Untested.

---

## What to build first

**Superseded by the blind test.** `clamp` was going to be the smallest thing that proved the loop ran. The loop has now been run on 729 lines of real event-sourcing code and it worked, so `clamp` would prove less than what is already known. The original plan is kept below for the record.

The engine is proven; what is missing is the **gate around it**. The smallest useful thing now:

```
propose   claude -p, one module, one prompt   →  propositions + guards + gaps    [PROVEN]
verify    one probe test per claim            →  which claims survive?           [BUILD THIS]
report    only what survived                  →  a findings list you can trust
```

The verify step is the whole product. Tonight's run produced 22 claims and **one** of them is confirmed — a model that generates 22 plausible claims and no way to sort them is a liability, not a tool. The gate is what turns it into something you would actually run on your own repositories.

Concretely: given a claim with a concrete witness, generate a probe test that *fails if the claim is true*, run it, and keep only the claims whose probes fail. That is mechanical, it is not a model judging itself, and it is what separated the one real bug from the twenty-one maybes tonight.

**And build the fixture check alongside it**, because tonight showed the probe itself can be a lie: assert that the probe actually executes the code path it claims to test. Two of three probes here did not, and passed.

---

### Original plan, superseded

The smallest thing that tests the whole claim:

**Run the harness on `clamp` and print a mutation score.**

`clamp(value, min, max)` slots into v2's `comp-arithmetic` component next to `max` and `abs`, so it is a real addition to real code, the domain is trivial, and it contains exactly one honest decision (the empty range).

```
propose      claude -p  → propositions + guards for clamp
check        solver     → must surface min > max unprompted    ← the test of the design
review       human      → decide: precondition / swap / trap / a bound wins
materialize  claude -p  → one test per leaf
prove        mutation   → what fraction of tests are load-bearing?
```

**The success criterion is a number.** Hand-written `max` scored **2 of 5 load-bearing — 60% noise**. If the harness produces a suite that is 3-of-3, the thing works and there is a measurement proving it. If it produces 5-of-12, it doesn't, and that was learned cheaply.

That score is also the harness's own regression test: run it over `max`, `abs`, `clamp`, track the ratio, and a prompt change that makes it worse is visible immediately.

**Do not build a CLI, a schema, or a store integration before that number exists.** The failure mode of this entire project is beautiful structure that nobody maintains.
