# Verify Gate — experiment plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Produce a number — the four-verdict distribution over the 22 cold-pass claims about hive's `event-store.ts` — by generating one probe per claim, proving via coverage that the probe reached the code it names, and classifying the result.

**This is an experiment, not a package.** It asks one question — *can a coverage-checked probe sort real findings from plausible ones?* — and it is allowed to fail. It lives in `packages/v3/experiments/`, runs directly with `node`, and installs nothing into v3. Only two surfaces earn a test: the pure verdict logic (it *is* the product) and the answer key (the regression the design leans on). Everything else is breezy script code, promoted to a tested module later only if the number earns it.

**Why the reshape (node 373):** the earlier plan built `packages/v3/gate/` — a package.json, eight modules, five vitest suites, a CLI — before the number existed. That violates DESIGN.md's closing rule (*"Do not build a CLI, a schema, or a store integration before that number exists. The failure mode of this entire project is beautiful structure that nobody maintains"*) and its promotion model (*experiments earn tests through the waist; they don't start as them*). v3 has no vitest anyway, so the gate's own tests use node's built-in runner.

**Tech Stack:** TypeScript on Node 24 (native type stripping — no build step). Gate's own tests: `node --test` with `node:test` + `node:assert`. Probes run inside hive under hive's own vitest, in a pinned worktree. The only LLM call is `claude -p` for probe generation.

**Spec:** `docs/superpowers/specs/2026-07-14-verify-gate-design.md`
**Decision nodes:** 369 (design), 373 (reshape). Cite `1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1`.

## Global Constraints

- **No build step, no package.json in v3.** Run `.ts` files directly: `node file.ts`, tests `node --test file.test.ts`. Both verified on v24.12.0.
- **hive is pinned to `5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9`** — hive's HEAD and the exact tree the cold pass read (`event-store.ts` last changed at `5aade99`, two commits earlier). Never run against a moving `HEAD`; a verdict you can't reproduce isn't a verdict.
- **The gate never runs hive's own 162 tests.** One vitest invocation per probe, `include` scoped to that one probe file.
- **The 22 claims are the 14 gaps + 8 contradictions**, not the 29 propositions. Propositions are context for the probe prompt, never verified.
- **Every `claude -p` result is cached** to `packages/v3/experiments/verify-gate/probes/<claim-id>.json`. A re-run costs no tokens; a verdict stays replayable against the probe that produced it.
- **Infrastructure failure aborts the run.** A failed `pnpm install` must never become 22 `INVALID` verdicts.
- **Never commit anything under `.mycelium/`** (the worktree cache) — it's gitignored.
- **Commits cite the decision.** End every commit with `Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1`. The `commit-msg` hook checks that your changed files overlap the files node 369 declares (`…/specs/2026-07-14-verify-gate-design.md`, `…/plans/2026-07-14-verify-gate.md`, `packages/v3/gate`). **Before Task 1, add `packages/v3/experiments/verify-gate` to node 369's files** (command in Task 1, Step 0) so the hook accepts these commits. Write commit messages in plain prose — no bullet lists, no "Generated with" footers.

---

## File Structure

All under `packages/v3/experiments/verify-gate/`, alongside the existing `mutate.ts` / `exhaustive.ts` / `blind-test/`.

| file | responsibility | tested? |
|---|---|---|
| `verdict.ts` | **the product, pure.** Types + `parseCoverage` + `checkReach` + `decide`. No I/O. | **yes — `node --test`** |
| `verdict.test.ts` | exhaustive tests of the four verdicts and reach. Milliseconds. | — |
| `claims.ts` | `cold-pass-output.json` → `Claim[]`. Strips the ```` ```json ```` fence. | no |
| `worktree.ts` | create/cache the pinned hive worktree with coverage installed. | no |
| `run-probe.ts` | write one probe into the worktree, run it, return outcome + coverage. | no |
| `probe.ts` | one `claude -p` per claim → `{probe, reaches}`, cached. | no |
| `prompt.md` | the probe prompt template. | — |
| `run.ts` | the experiment: wire it together, print the distribution, **assert the answer key**. | **it IS the regression** |

The plumbing (`claims`/`worktree`/`run-probe`/`probe`) is deliberately untested at unit level. Its correctness is proven end-to-end by the answer key in `run.ts`: if the plumbing is wrong, the three known claims come back wrong and `run.ts` exits non-zero.

---

## Task 1: Spike — prove coverage attributes to source lines

**This can invalidate the design.** hive's tests import the *built* `@hive/core` (`"exports": {".": "./dist/index.js"}`), so v8 coverage sees `dist/lib/event-store.js`. If it doesn't remap to `src/lib/event-store.ts`, every line-based reach target is meaningless. Settle this before writing any gate code.

**Files:**
- Create: `packages/v3/experiments/verify-gate/spike/gate-spike.test.ts` (throwaway)
- Create: `packages/v3/experiments/verify-gate/vitest.gate.config.ts` (kept — used by `run-probe.ts` in Task 3)

- [ ] **Step 0: Make these commits citable**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
sqlite3 .deciduous/deciduous.db "UPDATE decision_nodes SET metadata_json = json_set(COALESCE(metadata_json,'{}'), '\$.files', json_array('docs/superpowers/specs/2026-07-14-verify-gate-design.md','docs/superpowers/plans/2026-07-14-verify-gate.md','packages/v3/gate','packages/v3/experiments/verify-gate')) WHERE id = 369;"
grep -qxF '.mycelium/' .gitignore || printf '.mycelium/\n' >> .gitignore
```

- [ ] **Step 1: Create the pinned worktree**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
mkdir -p .mycelium/worktrees
git -C ../hive worktree add --detach \
  "$(pwd)/.mycelium/worktrees/hive-5d52a98" \
  5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9
```

Expected: `Preparing worktree (detached HEAD 5d52a98)`.

- [ ] **Step 2: Install, build core, add the coverage provider**

A worktree has no `node_modules`. This may take minutes — that is the install, not a hang.

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees/hive-5d52a98
pnpm install
pnpm build:core
pnpm --filter @hive/tests add -D @vitest/coverage-v8@^1.0.0
ls packages/core/dist/lib/event-store.js*   # expect event-store.js AND event-store.js.map
```

- [ ] **Step 3: Write the spike probe**

This is the C4 claim — a bug already known to be real, copied from the third test in `packages/v3/experiments/blind-test/probes.test.ts`. Write to `.mycelium/worktrees/hive-5d52a98/packages/tests/src/gate-spike.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import git from 'isomorphic-git';
import {
  recordEvent, recordStateTransition, replayEvents,
  getDatabase, getAllNodes, insertNode, createTestContext,
  HiveContext, Node,
} from '@hive/core';

const branch = 'hive-test';

async function bootstrap(): Promise<{ ctx: HiveContext; dir: string }> {
  const dir = '/test-repo';
  const ctx = await createTestContext(dir);
  ctx.fs.mkdirSync(dir, { recursive: true });
  ctx.fs.mkdirSync(`${dir}/.hive`, { recursive: true });
  await git.init({ fs: ctx.fs as any, dir, defaultBranch: 'main' });
  await git.setConfig({ fs: ctx.fs as any, dir, path: 'user.name', value: 'Test User' });
  await git.setConfig({ fs: ctx.fs as any, dir, path: 'user.email', value: 'test@example.com' });
  ctx.fs.writeFileSync(`${dir}/README.md`, '# Test');
  await git.add({ fs: ctx.fs as any, dir, filepath: 'README.md' });
  await git.commit({
    fs: ctx.fs as any, dir, message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' },
  });
  await git.branch({ fs: ctx.fs as any, dir, ref: branch });
  return { ctx, dir };
}

async function addNode(ctx: HiveContext, title: string): Promise<string> {
  const id = await recordEvent(
    ctx, { type: 'add', nodeType: 'decision', content: title, confidence: 90 }, branch,
  );
  const db = getDatabase(ctx);
  const now = new Date().toISOString();
  const node: Node = {
    change_id: id, branch, node_type: 'decision', title,
    status: 'pending', created_at: now, updated_at: now,
  };
  insertNode(db, node);
  return id;
}

describe('C4', () => {
  it('does not corrupt a node status with an unrelated property value', async () => {
    const { ctx } = await bootstrap();
    const nodeId = await addNode(ctx, 'Use PostgreSQL');
    await replayEvents(ctx, branch, true);
    await recordStateTransition(ctx, nodeId, 'confidence', '95', branch);
    await replayEvents(ctx, branch, true);
    const status = getAllNodes(getDatabase(ctx)).find(n => n.change_id === nodeId)?.status;
    expect(status).not.toBe('95');
  });
});
```

- [ ] **Step 4: Write the gate vitest config**

Write BOTH to `.mycelium/worktrees/hive-5d52a98/packages/tests/vitest.gate.config.ts` AND (a copy) to `packages/v3/experiments/verify-gate/vitest.gate.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

const probe = process.env.GATE_PROBE;
const covDir = process.env.GATE_COV;
if (!probe || !covDir) throw new Error('GATE_PROBE and GATE_COV must be set');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [probe],
    testTimeout: 30000,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: covDir,
      include: ['**/packages/core/**'],
      all: false,
      clean: true,
    },
  },
});
```

- [ ] **Step 5: Run it and inspect where coverage landed**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees/hive-5d52a98/packages/tests
GATE_PROBE='src/gate-spike.test.ts' GATE_COV='/tmp/gate-cov' \
  MISE_DISABLE_HOOKS=1 pnpm exec vitest run \
  --config vitest.gate.config.ts \
  --reporter=json --outputFile=/tmp/gate-result.json
```

Expected: the test **FAILS** with `expected '95' not to be '95'`. That failure is the point — C4 is a real bug. If it does NOT fail, that is itself a finding — record it and stop.

Then the decisive check:

```bash
node -e "
const c = require('/tmp/gate-cov/coverage-final.json');
const keys = Object.keys(c);
console.log('files in coverage:'); keys.forEach(k => console.log('  ', k));
const es = keys.filter(k => k.includes('event-store'));
console.log('\nevent-store entries:', es);
es.forEach(k => {
  const hit = Object.entries(c[k].s).filter(([, n]) => n > 0).length;
  console.log('  ', k, '->', hit, 'covered statements');
});
"
```

- [ ] **Step 6: Decide and record**

- **PASS-A** — a key ending `src/lib/event-store.ts` with covered statements. Design holds. Proceed.
- **FAIL → apply Plan B: alias `@hive/core` to source.** Add to the config's `defineConfig`:
  ```ts
  resolve: { alias: { '@hive/core': new URL('../core/src/index.ts', import.meta.url).pathname } },
  ```
  and change `coverage.include` to `['**/packages/core/src/**']`. Re-run Step 5. If it now attributes to `src/**`, that is **PASS-B** — note the tradeoff: probes then exercise hive's *source*, not its built artifact. Update BOTH copies of the config.
- **FAIL both ways** — stop and report. Line-based reach is unavailable; the design needs a different reach mechanism. Do not proceed.

- [ ] **Step 7: Clean up, keep the config, commit**

```bash
rm /Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees/hive-5d52a98/packages/tests/src/gate-spike.test.ts
cd /Users/bigmistqke/Documents/GitHub/mycelium
mkdir -p packages/v3/experiments/verify-gate/spike
# keep a copy of the spike probe for the record
git add packages/v3/experiments/verify-gate .gitignore
git commit -F - <<'EOF'
experiment(gate): prove a probe's coverage lands on source, not build output

The gate will check that a probe touched the lines it claims to. That check
reads coverage, and hive's tests import the compiled package rather than its
source, so coverage could describe build output instead — in which case every
line number the gate reasons about refers to a file nobody wrote. So this runs
one probe, for a bug already known to be real, and looks at where the coverage
actually landed before anything is built on it.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 2: The verdict logic — the product, and the only unit-tested surface

Pure. No I/O. Written test-first with `node --test`.

**Files:**
- Create: `packages/v3/experiments/verify-gate/verdict.ts`
- Create: `packages/v3/experiments/verify-gate/verdict.test.ts`

**Interfaces produced (used by Task 3):**
- types `Claim`, `ReachTarget`, `Probe`, `RunOutcome`, `CoverageMap`, `Verdict`, `ReachCheck`, `Result`
- `parseCoverage(coverageFinalPath: string, hiveRoot: string): CoverageMap`
- `checkReach(targets: ReachTarget[], covered: CoverageMap): ReachCheck[]`
- `decide(outcome: RunOutcome, reach: ReachCheck[]): { verdict: Verdict; reason: string }`

- [ ] **Step 1: Write the failing test**

`verdict.test.ts`:

```ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkReach, decide } from './verdict.ts';
import type { CoverageMap, ReachTarget } from './verdict.ts';

const EVENT_STORE = 'packages/core/src/lib/event-store.ts';
const target = (lines: number[]): ReachTarget => ({ file: EVENT_STORE, lines });
const covering = (lines: number[]): CoverageMap => new Map([[EVENT_STORE, new Set(lines)]]);

describe('checkReach', () => {
  test('satisfied when at least one declared line executed', () => {
    const [c] = checkReach([target([100, 101, 102])], covering([101]));
    assert.equal(c.satisfied, true);
    assert.deepEqual(c.hit, [101]);
    assert.deepEqual(c.missed, [100, 102]);
  });
  test('not satisfied when none of the declared lines executed', () => {
    const [c] = checkReach([target([677, 678])], covering([100]));
    assert.equal(c.satisfied, false);
    assert.deepEqual(c.hit, []);
  });
  test('not satisfied when the file never loaded', () => {
    const [c] = checkReach([target([100])], new Map());
    assert.equal(c.satisfied, false);
  });
  test('requires EVERY target satisfied, not just one', () => {
    const cs = checkReach([target([100]), target([677])], covering([100]));
    assert.deepEqual(cs.map(c => c.satisfied), [true, false]);
  });
});

describe('decide — the four verdicts', () => {
  const reached = checkReach([target([100])], covering([100]));
  const notReached = checkReach([target([677])], covering([100]));

  test('CONFIRMED: failed on assertion AND reached', () => {
    assert.equal(decide({ kind: 'assertion-failed', message: "AssertionError: expected '95' not to be '95'" }, reached).verdict, 'CONFIRMED');
  });
  test('REFUTED: passed AND reached', () => {
    assert.equal(decide({ kind: 'passed' }, reached).verdict, 'REFUTED');
  });
  test('UNREACHABLE: passed but executed none of the named code — THE BUG THIS GATE EXISTS FOR', () => {
    // Two of three hand probes did exactly this last session; pass/fail called them REFUTED.
    assert.equal(decide({ kind: 'passed' }, notReached).verdict, 'UNREACHABLE');
  });
  test('UNREACHABLE: failed but reached nothing is not a confirmation', () => {
    assert.equal(decide({ kind: 'assertion-failed', message: 'AssertionError: nope' }, notReached).verdict, 'UNREACHABLE');
  });
  test('INVALID: errored — the gate failed, not the claim', () => {
    assert.equal(decide({ kind: 'errored', message: 'TypeError: x is not a function' }, reached).verdict, 'INVALID');
  });
  test('INVALID beats reach: an errored probe is never a finding', () => {
    assert.equal(decide({ kind: 'errored', message: 'boom' }, reached).verdict, 'INVALID');
    assert.equal(decide({ kind: 'errored', message: 'boom' }, notReached).verdict, 'INVALID');
  });
  test('reason names the missed lines', () => {
    const { reason } = decide({ kind: 'passed' }, notReached);
    assert.match(reason, /677/);
    assert.match(reason, /event-store\.ts/);
  });
});
```

- [ ] **Step 2: Run it, watch it fail**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/experiments/verify-gate
node --test verdict.test.ts
```

Expected: FAIL — cannot resolve `./verdict.ts`.

- [ ] **Step 3: Implement**

`verdict.ts`:

```ts
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

/** A claim is a GAP or CONTRADICTION from the cold pass. Not a proposition. */
export interface Claim {
  id: string;                // 'G1'..'G14', 'C1'..'C8'
  kind: 'gap' | 'contradiction';
  witness: string;
  whyItMatters: string;
  propositionA?: string;
  propositionB?: string;
}

/** Source lines a probe DECLARES it will run. A falsifiable claim, checked vs coverage. */
export interface ReachTarget { file: string; lines: number[]; }

export interface Probe { claimId: string; probe: string; reaches: ReachTarget[]; }

export type RunOutcome =
  | { kind: 'passed' }
  | { kind: 'assertion-failed'; message: string }
  | { kind: 'errored'; message: string };

/** file -> the set of line numbers that executed. */
export type CoverageMap = Map<string, Set<number>>;

export type Verdict = 'CONFIRMED' | 'REFUTED' | 'UNREACHABLE' | 'INVALID';

export interface ReachCheck { target: ReachTarget; hit: number[]; missed: number[]; satisfied: boolean; }

export interface Result { claim: Claim; verdict: Verdict; reason: string; reach: ReachCheck[]; }

/**
 * vitest's v8 provider writes coverage-final.json in istanbul shape:
 *   { "<abs>": { path, statementMap: { "0": {start:{line},end:{line}} }, s: { "0": hits } } }
 * A line executed if any statement covering it has non-zero hits. Paths are absolute;
 * rebased onto hiveRoot so a target reads 'packages/core/src/lib/event-store.ts'.
 */
export function parseCoverage(coverageFinalPath: string, hiveRoot: string): CoverageMap {
  const raw = JSON.parse(readFileSync(coverageFinalPath, 'utf8')) as Record<string, {
    path: string;
    statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
    s: Record<string, number>;
  }>;
  const map: CoverageMap = new Map();
  for (const entry of Object.values(raw)) {
    const file = relative(hiveRoot, entry.path);
    const lines = map.get(file) ?? new Set<number>();
    for (const [id, hits] of Object.entries(entry.s)) {
      if (hits <= 0) continue;
      const stmt = entry.statementMap[id];
      if (!stmt) continue;
      for (let l = stmt.start.line; l <= stmt.end.line; l++) lines.add(l);
    }
    map.set(file, lines);
  }
  return map;
}

/**
 * SATISFIED if at least one declared line executed. Not all: a model naming a range
 * includes braces and blank lines v8 never reports as run, and demanding every line
 * would reject honest probes — the commit-msg hook already taught that a gate's
 * dangerous failure is the FALSE rejection, because it teaches people to route around
 * it. At-least-one still catches the lie that matters: a probe that never runs the
 * named code scores ZERO, not low. The hit ratio is reported regardless.
 */
export function checkReach(targets: ReachTarget[], covered: CoverageMap): ReachCheck[] {
  return targets.map(target => {
    const executed = covered.get(target.file) ?? new Set<number>();
    const hit = target.lines.filter(l => executed.has(l));
    const missed = target.lines.filter(l => !executed.has(l));
    return { target, hit, missed, satisfied: hit.length > 0 };
  });
}

/**
 * The gate. A probe can lie in BOTH directions, so reach is a precondition on every
 * verdict, not a filter at the end:
 *   failed -> claim real ... unless it threw in bootstrap, or ran none of its named code
 *   passed -> claim false ... unless it ran nothing at all
 * INVALID is checked first: an errored probe says nothing about the claim, however
 * much of the file it touched on its way down.
 */
export function decide(outcome: RunOutcome, reach: ReachCheck[]): { verdict: Verdict; reason: string } {
  if (outcome.kind === 'errored') {
    return { verdict: 'INVALID', reason: `the probe errored outside its assertion — the gate failed, not the claim: ${outcome.message}` };
  }
  if (reach.length === 0) {
    return { verdict: 'INVALID', reason: 'the probe declared no reach target, so nothing could be checked' };
  }
  const unmet = reach.filter(r => !r.satisfied);
  if (unmet.length > 0) {
    const where = unmet.map(r => `${r.target.file}:${r.target.lines.join(',')}`).join('; ');
    return { verdict: 'UNREACHABLE', reason: `the probe ran, but none of the lines it named executed (${where}) — the code is unreachable under this test harness, so the claim cannot be tested here` };
  }
  if (outcome.kind === 'assertion-failed') {
    return { verdict: 'CONFIRMED', reason: `the probe reached the code and failed on its assertion: ${outcome.message.split('\n')[0]}` };
  }
  return { verdict: 'REFUTED', reason: 'the probe reached the code and passed — the claim does not hold' };
}
```

- [ ] **Step 4: Run it, watch it pass**

```bash
node --test verdict.test.ts
```

Expected: `pass 11`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/experiments/verify-gate/verdict.ts packages/v3/experiments/verify-gate/verdict.test.ts
git commit -F - <<'EOF'
experiment(gate): judge a probe by what it touched, not by whether it passed

A failing probe is meant to mean the claim it was written against is real, and a
passing probe that the claim is false. Both are wrong alone. A failing probe may
have thrown while setting itself up and never reached its assertion. A passing
probe may have run none of the code it was about, which is what two of three
hand probes did last session — green because they tested nothing.

So the probe declares which lines it will run, and coverage checks whether it
did, before passing or failing is read at all. Four outcomes fall out, not two:
the claim holds, it does not, the code was never reached, or the probe was
broken. A line counts as reached if any named line ran — demanding all of them
would reject honest probes over blank lines, and a gate that rejects honest work
is one people learn to bypass.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 3: The experiment — wire it, print the number, assert the answer key

Breezy plumbing plus the run. The answer key is the regression: if the plumbing is wrong, the three known claims come back wrong and the run exits non-zero.

**Files:**
- Create: `packages/v3/experiments/verify-gate/claims.ts`
- Create: `packages/v3/experiments/verify-gate/worktree.ts`
- Create: `packages/v3/experiments/verify-gate/run-probe.ts`
- Create: `packages/v3/experiments/verify-gate/probe.ts`
- Create: `packages/v3/experiments/verify-gate/prompt.md`
- Create: `packages/v3/experiments/verify-gate/run.ts`

**Interfaces consumed:** everything from `verdict.ts`.

- [ ] **Step 1: `claims.ts`**

```ts
import { readFileSync } from 'node:fs';
import type { Claim } from './verdict.ts';

/** The cold pass wrapped its JSON in a ```json fence, so the corpus is not valid JSON. */
function stripFences(raw: string): string {
  return raw.replace(/^\s*```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
}

interface RawGap { witness: string; why_it_matters: string; }
interface RawContra extends RawGap { proposition_a?: string; proposition_b?: string; }

/**
 * The 22 CLAIMS are the gaps + contradictions. The 29 propositions are the module's
 * contract — context for probing, never verified. Gaps/contradictions carry no id, so
 * they are numbered by index; stable because the corpus file is frozen.
 */
export function loadClaims(path: string): Claim[] {
  const p = JSON.parse(stripFences(readFileSync(path, 'utf8'))) as { gaps: RawGap[]; contradictions: RawContra[] };
  const gaps: Claim[] = p.gaps.map((g, i) => ({
    id: `G${i + 1}`, kind: 'gap', witness: g.witness, whyItMatters: g.why_it_matters,
  }));
  const contradictions: Claim[] = p.contradictions.map((c, i) => ({
    id: `C${i + 1}`, kind: 'contradiction', witness: c.witness, whyItMatters: c.why_it_matters,
    propositionA: c.proposition_a, propositionB: c.proposition_b,
  }));
  return [...gaps, ...contradictions];
}
```

- [ ] **Step 2: `worktree.ts`**

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** hive's HEAD and the exact tree the cold pass read. Never a moving HEAD. */
export const HIVE_SHA = '5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9';

const sh = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * A pinned, CACHED worktree of hive. Cached because `pnpm install` is the slow part and
 * identical every run. Any failure THROWS — infrastructure failure must never be
 * laundered into INVALID verdicts. The gate config is copied in from this experiment dir.
 */
export function ensureWorktree(opts: { hiveRepo: string; sha: string; root: string; configSrc: string }): string {
  const dir = join(opts.root, `hive-${opts.sha.slice(0, 7)}`);
  const stamp = join(dir, '.gate-ready');
  if (existsSync(stamp)) return dir;
  mkdirSync(opts.root, { recursive: true });
  if (!existsSync(dir)) sh('git', ['worktree', 'add', '--detach', dir, opts.sha], opts.hiveRepo);
  sh('pnpm', ['install'], dir);
  sh('pnpm', ['build:core'], dir);
  sh('pnpm', ['--filter', '@hive/tests', 'add', '-D', '@vitest/coverage-v8@^1.0.0'], dir);
  writeFileSync(join(dir, 'packages/tests/vitest.gate.config.ts'), readFileSync(opts.configSrc, 'utf8'));
  writeFileSync(stamp, `${opts.sha}\n`);
  return dir;
}
```

- [ ] **Step 3: `run-probe.ts`**

```ts
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseCoverage } from './verdict.ts';
import type { CoverageMap, RunOutcome } from './verdict.ts';

const exec = promisify(execFile);

interface VitestJson {
  testResults?: Array<{ assertionResults?: Array<{ status: string; failureMessages?: string[] }>; message?: string }>;
}

/**
 * An expect() failure surfaces as an AssertionError. Anything else the probe throws is
 * the PROBE being broken, not the claim being true. This is what stops "my setup threw"
 * being reported as "I found a bug".
 */
function classify(json: VitestJson, stderr: string): RunOutcome {
  const results = json.testResults ?? [];
  const assertions = results.flatMap(r => r.assertionResults ?? []);
  if (assertions.length === 0) {
    const msg = results.map(r => r.message).filter(Boolean).join('\n') || stderr;
    return { kind: 'errored', message: (msg || 'no test results').slice(0, 2000) };
  }
  const failed = assertions.filter(a => a.status === 'failed');
  if (failed.length === 0) return { kind: 'passed' };
  const messages = failed.flatMap(a => a.failureMessages ?? []).join('\n');
  return /AssertionError/.test(messages)
    ? { kind: 'assertion-failed', message: messages.slice(0, 2000) }
    : { kind: 'errored', message: messages.slice(0, 2000) };
}

/**
 * Run ONE probe, alone, in the pinned worktree. Alone so coverage is attributable and a
 * crash can't take the others down. hive's own 162 tests are never run.
 */
export async function runProbe(opts: { worktree: string; claimId: string; source: string }): Promise<{ outcome: RunOutcome; covered: CoverageMap }> {
  const testsPkg = join(opts.worktree, 'packages/tests');
  const rel = `src/gate-${opts.claimId}.test.ts`;
  const probePath = join(testsPkg, rel);
  const covDir = join(opts.worktree, '.gate', opts.claimId, 'coverage');
  const resultPath = join(opts.worktree, '.gate', opts.claimId, 'result.json');
  mkdirSync(join(opts.worktree, '.gate', opts.claimId), { recursive: true });
  writeFileSync(probePath, opts.source);

  let stderr = '', stdout = '';
  try {
    const r = await exec('pnpm',
      ['exec', 'vitest', 'run', '--config', 'vitest.gate.config.ts', '--reporter=json', `--outputFile=${resultPath}`],
      { cwd: testsPkg, env: { ...process.env, GATE_PROBE: rel, GATE_COV: covDir, MISE_DISABLE_HOOKS: '1' }, maxBuffer: 32 * 1024 * 1024 });
    stdout = r.stdout; stderr = r.stderr;
  } catch (e: any) {
    stdout = e?.stdout ?? ''; stderr = e?.stderr ?? String(e);   // a failing test exits non-zero — that is data
  } finally {
    rmSync(probePath, { force: true });
  }

  let json: VitestJson = {};
  if (existsSync(resultPath)) { try { json = JSON.parse(readFileSync(resultPath, 'utf8')); } catch {} }
  const outcome = classify(json, stderr || stdout);
  const covFile = join(covDir, 'coverage-final.json');
  const covered = existsSync(covFile) ? parseCoverage(covFile, opts.worktree) : (new Map() as CoverageMap);
  return { outcome, covered };
}
```

- [ ] **Step 4: `prompt.md`**

````markdown
You are writing ONE falsification probe for ONE claim about hive's event store.

The claim was produced by a model reading `packages/core/src/lib/event-store.ts`. It
asserts the module's behaviour is either UNSPECIFIED (a gap) or SPECIFIED TWICE AND
INCOMPATIBLY (a contradiction). Find out whether it is true.

## The claim
KIND: {{KIND}}
WITNESS: {{WITNESS}}
WHY IT MATTERS: {{WHY}}

## The module's contract, as the same model described it
{{PROPOSITIONS}}

## Your job
Write a SINGLE vitest test that **FAILS if the claim is TRUE**. You are falsifying it:
assert the behaviour that SHOULD hold. If the claim is real your assertion won't hold and
the test fails — that failure is the finding. Do NOT assert the buggy behaviour and pass;
that inverts the polarity and makes the bug look like the spec.

## Rules
- ONE `describe`, ONE `it`. No extra assertions.
- The failure must come from `expect()`, not a throw. A probe that dies in setup proves
  nothing and is discarded.
- Import only from `vitest`, `isomorphic-git`, `@hive/core`.
- Use these bootstrap helpers VERBATIM. Do not invent your own fixture.

```ts
const branch = 'hive-test';
async function bootstrap(): Promise<{ ctx: HiveContext; dir: string }> {
  const dir = '/test-repo';
  const ctx = await createTestContext(dir);
  ctx.fs.mkdirSync(dir, { recursive: true });
  ctx.fs.mkdirSync(`${dir}/.hive`, { recursive: true });
  await git.init({ fs: ctx.fs as any, dir, defaultBranch: 'main' });
  await git.setConfig({ fs: ctx.fs as any, dir, path: 'user.name', value: 'Test User' });
  await git.setConfig({ fs: ctx.fs as any, dir, path: 'user.email', value: 'test@example.com' });
  ctx.fs.writeFileSync(`${dir}/README.md`, '# Test');
  await git.add({ fs: ctx.fs as any, dir, filepath: 'README.md' });
  await git.commit({ fs: ctx.fs as any, dir, message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' } });
  await git.branch({ fs: ctx.fs as any, dir, ref: branch });
  return { ctx, dir };
}
async function addNode(ctx: HiveContext, title: string): Promise<string> {
  const id = await recordEvent(ctx, { type: 'add', nodeType: 'decision', content: title, confidence: 90 }, branch);
  const db = getDatabase(ctx);
  const now = new Date().toISOString();
  const node: Node = { change_id: id, branch, node_type: 'decision', title, status: 'pending', created_at: now, updated_at: now };
  insertNode(db, node);
  return id;
}
```

## Declare what you will execute
Name the lines of `packages/core/src/lib/event-store.ts` your probe will cause to run —
where the claimed behaviour lives. This is checked against real coverage. **If none of
the lines you name execute, your probe is discarded.** Read the file first; line numbers
must match the version on disk.

## Output — JSON ONLY, no prose, no code fence.
{
  "probe": "<the complete .test.ts file, as a string>",
  "reaches": [ { "file": "packages/core/src/lib/event-store.ts", "lines": [120, 121, 122] } ]
}
````

- [ ] **Step 5: `probe.ts`**

```ts
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Claim, Probe } from './verdict.ts';

const exec = promisify(execFile);
const TEMPLATE = new URL('./prompt.md', import.meta.url).pathname;

export function buildPrompt(claim: Claim, propositions: string): string {
  return readFileSync(TEMPLATE, 'utf8')
    .replace('{{KIND}}', claim.kind)
    .replace('{{WITNESS}}', claim.witness)
    .replace('{{WHY}}', claim.whyItMatters)
    .replace('{{PROPOSITIONS}}', propositions);
}

/** The prompt says no fence; the cold pass emitted one anyway. Tolerate it. */
export function parseProbeResponse(claimId: string, raw: string): Probe {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`probe response for ${claimId} contained no JSON object`);
  const parsed = JSON.parse(raw.slice(start, end + 1)) as { probe: string; reaches: Array<{ file: string; lines: number[] }> };
  if (!parsed.probe || !Array.isArray(parsed.reaches)) throw new Error(`probe response for ${claimId} missing probe or reaches`);
  return { claimId, probe: parsed.probe, reaches: parsed.reaches };
}

/**
 * One bounded call per claim, cached. "Write the single probe that fails if this claim is
 * true, and declare the lines it touches" has one right answer and no room to pad. Cached
 * because claude -p is not deterministic and a verdict must stay replayable. Run inside
 * hive so the model can read event-store.ts for line numbers.
 */
export async function generateProbe(claim: Claim, opts: { cacheDir: string; propositions: string; hiveRepo: string; retries?: number }): Promise<Probe> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const cached = join(opts.cacheDir, `${claim.id}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8')) as Probe;
  const prompt = buildPrompt(claim, opts.propositions);
  const attempts = (opts.retries ?? 1) + 1;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await exec('claude', ['-p', prompt], { maxBuffer: 32 * 1024 * 1024, timeout: 300_000, cwd: opts.hiveRepo });
      const probe = parseProbeResponse(claim.id, stdout);
      writeFileSync(cached, JSON.stringify(probe, null, 2));
      return probe;
    } catch (e) { lastError = e; }
  }
  throw new Error(`could not generate a probe for ${claim.id}: ${String(lastError)}`);
}
```

- [ ] **Step 6: `run.ts` — the experiment**

```ts
import { readFileSync } from 'node:fs';
import { loadClaims } from './claims.ts';
import { generateProbe } from './probe.ts';
import { runProbe } from './run-probe.ts';
import { checkReach, decide } from './verdict.ts';
import { ensureWorktree, HIVE_SHA } from './worktree.ts';
import type { Claim, Result, Verdict } from './verdict.ts';

const HERE = new URL('.', import.meta.url).pathname;
const HIVE = '/Users/bigmistqke/Documents/GitHub/hive';
const ROOT = new URL('../../../../.mycelium/worktrees', import.meta.url).pathname;
const CORPUS = new URL('../blind-test/cold-pass-output.json', import.meta.url).pathname;
const CACHE = HERE + 'probes';
const CONFIG = HERE + 'vitest.gate.config.ts';

/** Known ground truth. The reason this corpus was chosen: it checks the gate. */
const ANSWER_KEY: Record<string, Verdict> = { C4: 'CONFIRMED', C1: 'UNREACHABLE', G1: 'UNREACHABLE' };

async function verifyClaim(claim: Claim, worktree: string, propositions: string): Promise<Result> {
  let probe;
  try {
    probe = await generateProbe(claim, { cacheDir: CACHE, propositions, hiveRepo: HIVE });
  } catch (e) {
    return { claim, verdict: 'INVALID', reason: `no probe generated: ${String(e)}`, reach: [] };
  }
  const { outcome, covered } = await runProbe({ worktree, claimId: claim.id, source: probe.probe });
  const reach = checkReach(probe.reaches, covered);
  const { verdict, reason } = decide(outcome, reach);
  return { claim, verdict, reason, reach };
}

function report(results: Result[]): void {
  const order: Verdict[] = ['CONFIRMED', 'UNREACHABLE', 'REFUTED', 'INVALID'];
  const tally = { CONFIRMED: 0, REFUTED: 0, UNREACHABLE: 0, INVALID: 0 } as Record<Verdict, number>;
  for (const r of results) tally[r.verdict]++;
  console.log(`\n  ${results.length} claims, verified against hive@${HIVE_SHA.slice(0, 7)}\n`);
  for (const v of order) {
    const g = results.filter(r => r.verdict === v);
    if (!g.length) continue;
    console.log(`  ${v}  (${g.length})`);
    for (const r of g) {
      console.log(`    ${r.claim.id}  ${r.claim.witness.split('\n')[0].slice(0, 88)}`);
      console.log(`         ${r.reason.slice(0, 108)}`);
    }
    console.log('');
  }
  console.log('  ' + '─'.repeat(45));
  console.log(`  ${tally.CONFIRMED} confirmed · ${tally.UNREACHABLE} unreachable · ${tally.REFUTED} refuted · ${tally.INVALID} invalid\n`);
  if (tally.INVALID > results.length / 4)
    console.log('  ⚠ a quarter of probes did not run — that is a verdict on the PROMPT, not the claims. Fix the prompt first.\n');
}

async function main() {
  const worktree = ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT, configSrc: CONFIG }); // throws on infra failure
  const claims = loadClaims(CORPUS);
  const propositions = readFileSync(CORPUS, 'utf8');
  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const todo = only.length ? claims.filter(c => only.includes(c.id)) : claims;

  const results: Result[] = [];
  for (const claim of todo) {
    process.stderr.write(`  ${claim.id} … `);
    const r = await verifyClaim(claim, worktree, propositions);
    process.stderr.write(`${r.verdict}\n`);
    results.push(r);
  }
  report(results);

  // The answer key IS the regression. If any known claim is wrong, the run fails.
  const wrong = results.filter(r => ANSWER_KEY[r.claim.id] && r.verdict !== ANSWER_KEY[r.claim.id]);
  if (wrong.length) {
    console.error('\n  ✗ ANSWER KEY VIOLATED — the gate is not trustworthy:');
    for (const r of wrong) console.error(`    ${r.claim.id}: expected ${ANSWER_KEY[r.claim.id]}, got ${r.verdict}`);
    console.error('\n    Do NOT tune the assertion to match. The reach check is not working.\n');
    process.exit(1);
  }
}

await main();
```

- [ ] **Step 7: Verify one probe generates sanely**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/experiments/verify-gate
node run.ts C4
```

Expected: `C4 … CONFIRMED`, and the answer-key check passes for C4. If C4 is `INVALID`, the generated probe is broken — compare against `../blind-test/probes.test.ts` (a known-working probe for C4) and fix the **prompt**, not the gate.

- [ ] **Step 8: Run the answer key, then the full corpus**

```bash
node run.ts C4 C1 G1     # the three known claims — must all match the answer key
node run.ts               # all 22 — the deliverable
```

**If C1 or G1 comes back REFUTED: STOP.** Do not tune anything. The reach check has failed at its one job — it is laundering an untested claim as tested. Debug `checkReach` and the coverage plumbing until the verdict is honest.

- [ ] **Step 9: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/experiments/verify-gate
git commit -F - <<'EOF'
experiment(gate): verify the twenty-two claims and check the gate against what we know

The experiment runs end to end and prints what it found: how many of the
twenty-two claims are real, false, untestable here, or produced a broken probe.
It checks itself first, which is the part that matters, because three of these
claims already have known answers and so test the gate rather than being tested
by it.

One is a real bug and must come back confirmed. The other two were probed by
hand last session and both probes passed while running none of the code they
were about — the path they need is dead under an in-memory filesystem. So those
two must come back unreachable, and if the gate calls either refuted it has
reproduced exactly the mistake it exists to prevent, and the run fails. The
naive version of this gate fails that check, which is what makes it a real test
rather than a ceremonial one.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

- [ ] **Step 10: Record the number**

```bash
deciduous add outcome "VERIFY GATE experiment ran: <X> confirmed, <Y> unreachable, <Z> refuted, <W> invalid over 22 claims vs hive@5d52a98. Answer key held: C4 CONFIRMED, C1+G1 UNREACHABLE. <Anything surprising in the other 19.>" -c 95 --commit HEAD
deciduous link 368 <id> -r "The goal, delivered as an experiment"
deciduous link 373 <id> -r "The reshape, run"
deciduous sync
```

---

## Self-Review

**Spec coverage.** probe/run/reach/report → Task 3 (`probe.ts`/`run-probe.ts`/`verdict.ts`/`run.ts`); the four verdicts + reach-as-precondition → Task 2; reach targets as a falsifiable declaration → Task 3 `prompt.md` + Task 2 `checkReach`; pinned cached worktree → Task 3 `worktree.ts`; fence-stripping + claim ids → Task 3 `claims.ts`; the source-map risk with Plan B → Task 1; failure handling (`classify`, worktree throws, INVALID on generation failure) → Tasks 2–3; the answer key → Task 3 `run.ts` + Task 1 spike. Mutation-reach stays out of scope.

**Placeholders.** The only `<…>` are in the Step-10 `deciduous` commands, where the values are the numbers the run produces. Every code step is complete.

**Type consistency.** All types live once in `verdict.ts` and are imported unchanged. `checkReach → ReachCheck[] → decide`; `parseCoverage → CoverageMap → checkReach`; `runProbe` returns `{ outcome, covered }` which `verifyClaim` feeds to `checkReach`/`decide`. `generateProbe` signature (`{ cacheDir, propositions, hiveRepo }`) matches its call in `run.ts`.

**Coupling to Task 1.** Task 2 and Task 3 assume Task 1 settled which path coverage attributes to. Reach targets and the `covered.get(file)` key must use the same path shape Task 1 confirmed (`src/**` under PASS-A/PASS-B). If Task 1 was PASS-B, the gate config already carries the alias; no gate code changes.
