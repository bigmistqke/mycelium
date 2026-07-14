# Verify Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the 22 claims a cold model made about hive's `event-store.ts`, by generating one probe per claim, proving the probe actually reached the code it names, and reporting four verdicts instead of pass/fail.

**Architecture:** Four stages — `probe` (the only LLM call, one per claim, cached), then `run`, `reach` and `report`, all deterministic. A probe declares in advance which source lines it intends to execute; v8 coverage checks that declaration. Probes run one-at-a-time in a disposable git worktree of hive pinned to a SHA, under a gate-supplied vitest config. hive's own 162 tests are never run.

**Tech Stack:** TypeScript on Node 24 (native type stripping — no build step), vitest 1.x + `@vitest/coverage-v8`, `claude -p`, git worktrees, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-14-verify-gate-design.md`
**Decision node:** 369 (`1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1`)

## Global Constraints

- **Node 24 native TS stripping.** Run `.ts` files directly with `node file.ts`. Verified working on v24.12.0. The gate has **no build step**.
- **hive is pinned to `5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9`.** This is hive's current HEAD and the exact tree the cold pass read (`event-store.ts` last changed two commits earlier, at `5aade99`). Never run the gate against a moving `HEAD`.
- **The gate never runs hive's own test suite.** One vitest invocation per probe, with `include` scoped to that single probe file.
- **The 22 claims are the 14 gaps + 8 contradictions**, not the 29 propositions. Propositions are the module's contract and are passed to the probe prompt as *context*, never verified.
- **Every `claude -p` result is cached to disk** under `packages/v3/gate/probes/<claim-id>.json`. A re-run costs no tokens and every verdict stays replayable against the probe that produced it.
- **Infrastructure failure aborts the run.** A failed `pnpm install` must never be reported as 22 `INVALID` verdicts.
- **Commits cite the decision.** Every commit in this plan ends with the trailer `Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1`. The `commit-msg` hook checks that the files you touched overlap the ones node 369 declares (`docs/superpowers/specs/2026-07-14-verify-gate-design.md`, `packages/v3/gate`). It will reject you otherwise. This is intended.

---

## File Structure

All paths relative to repo root `/Users/bigmistqke/Documents/GitHub/mycelium`.

| file | responsibility |
|---|---|
| `packages/v3/gate/package.json` | declares vitest for the gate's **own** tests. The gate's runtime deps are node builtins only. |
| `packages/v3/gate/src/types.ts` | every shared type. No logic. |
| `packages/v3/gate/src/claims.ts` | `cold-pass-output.json` → `Claim[]`. Strips the ```` ```json ```` fences. |
| `packages/v3/gate/src/coverage.ts` | `coverage-final.json` → `CoverageMap` (which lines of which files executed). |
| `packages/v3/gate/src/verdict.ts` | **the gate.** Pure. `(RunOutcome, ReachTarget[], CoverageMap) → Verdict`. |
| `packages/v3/gate/src/worktree.ts` | create/cache a pinned hive worktree with coverage installed. |
| `packages/v3/gate/src/run.ts` | run one probe file in the worktree, return outcome + coverage. |
| `packages/v3/gate/src/probe.ts` | one `claude -p` per claim → `{probe, reaches}`. Cached. |
| `packages/v3/gate/src/report.ts` | verdicts → a table and the number. |
| `packages/v3/gate/src/cli.ts` | wire it together. |
| `packages/v3/gate/prompts/probe.md` | the probe prompt template. |
| `packages/v3/gate/src/*.test.ts` | the gate's own tests, colocated. |

**Why `verdict.ts` is separate from `run.ts`:** the four-verdict logic is the entire product and it is pure. Keeping it free of subprocesses means it can be tested exhaustively in milliseconds, including against the answer key.

---

## Task 1: Prove coverage attributes to source lines

**This task can invalidate the design.** The spec's risk #1: hive's tests import the *built* `@hive/core` (`"exports": {".": "./dist/index.js"}`), so v8 coverage sees `dist/lib/event-store.js`. If it does not remap to `src/lib/event-store.ts`, every line-based reach target is meaningless and the gate is decorative.

Do this before writing a single line of the gate.

**Files:**
- Create: `packages/v3/gate/spike/probe-c4.test.ts` (throwaway, deleted at the end of this task)
- Create: `packages/v3/gate/spike/vitest.gate.config.ts` (kept — becomes the template in Task 5)

- [ ] **Step 1: Create the pinned worktree by hand**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
mkdir -p .mycelium/worktrees
git -C ../hive worktree add \
  "$(pwd)/.mycelium/worktrees/hive-5d52a98" \
  5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9
```

Expected: `Preparing worktree (detached HEAD 5d52a98)`.

- [ ] **Step 2: Install, build core, add the coverage provider**

A git worktree has no `node_modules` (gitignored), so this is required.

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees/hive-5d52a98
pnpm install
pnpm build:core
pnpm --filter @hive/tests add -D @vitest/coverage-v8@^1.0.0
```

Expected: `packages/core/dist/lib/event-store.js` and `event-store.js.map` both exist. Verify:

```bash
ls packages/core/dist/lib/event-store.js*
```

- [ ] **Step 3: Write the spike probe**

This is the C4 claim — the one already known to be a real bug. It is copied from the third test in `packages/v3/experiments/blind-test/probes.test.ts`, which is known to **fail** against hive. Write it to `.mycelium/worktrees/hive-5d52a98/packages/tests/src/gate-spike.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import git from 'isomorphic-git';
import {
  recordEvent,
  recordStateTransition,
  replayEvents,
  getDatabase,
  getAllNodes,
  insertNode,
  createTestContext,
  HiveContext,
  Node,
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
    fs: ctx.fs as any,
    dir,
    message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' },
  });
  await git.branch({ fs: ctx.fs as any, dir, ref: branch });
  return { ctx, dir };
}

async function addNode(ctx: HiveContext, title: string): Promise<string> {
  const id = await recordEvent(
    ctx,
    { type: 'add', nodeType: 'decision', content: title, confidence: 90 },
    branch,
  );
  const db = getDatabase(ctx);
  const now = new Date().toISOString();
  const node: Node = {
    change_id: id,
    branch,
    node_type: 'decision',
    title,
    status: 'pending',
    created_at: now,
    updated_at: now,
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

Write to `.mycelium/worktrees/hive-5d52a98/packages/tests/vitest.gate.config.ts`:

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

Expected: the test **FAILS** with `expected '95' not to be '95'`. That failure is the point — C4 is a real bug.

Now the decisive check:

```bash
node -e "
const c = require('/tmp/gate-cov/coverage-final.json');
const keys = Object.keys(c);
console.log('files in coverage:');
keys.forEach(k => console.log('  ', k));
const es = keys.filter(k => k.includes('event-store'));
console.log('\nevent-store entries:', es);
es.forEach(k => {
  const hit = Object.entries(c[k].s).filter(([, n]) => n > 0).length;
  console.log('  ', k, '->', hit, 'covered statements');
});
"
```

- [ ] **Step 6: Decide, and record the decision**

**PASS** — a key ending in `src/lib/event-store.ts` with covered statements. The design holds as written. Proceed to Task 2.

**FAIL (coverage attributes only to `dist/lib/event-store.js`)** — do **not** abandon the design. Apply **Plan B: alias `@hive/core` to source.** Add to the gate config's `defineConfig`:

```ts
resolve: {
  alias: {
    '@hive/core': new URL('../core/src/index.ts', import.meta.url).pathname,
  },
},
```

and change `coverage.include` to `['**/packages/core/src/**']`. This makes vitest transform hive's TypeScript source directly, so coverage attributes to `src/**` with no source-map dependency at all. Re-run Step 5. Note the tradeoff in the outcome node: the probes then exercise hive's *source* rather than its *built artifact*, which is a slightly different system.

**FAIL both ways** — stop and report. Line-based reach is not available and the gate needs a different reach mechanism (function-level coverage, or jump straight to mutation-reach). Do not proceed to Task 2.

- [ ] **Step 7: Clean up the spike probe, keep the config, record the outcome**

```bash
rm /Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees/hive-5d52a98/packages/tests/src/gate-spike.test.ts
mkdir -p /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate/spike
cp /Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees/hive-5d52a98/packages/tests/vitest.gate.config.ts \
   /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate/spike/vitest.gate.config.ts
```

Add `.mycelium/` to the repo's `.gitignore` if not already there.

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
deciduous add outcome "SPIKE: coverage attributes to <src or dist — say which>. <Plan A held / Plan B was needed>. This was the design's top risk and it is now retired." -c 95
deciduous link 369 <new_id> -r "The assumption the design rested on, tested first"
```

```bash
git add packages/v3/gate/spike .gitignore
git commit -F - <<'EOF'
feat(gate): prove a probe's coverage lands on source lines, not build output

The gate is about to check that a probe touched the lines it claims to touch.
That check reads coverage, and hive's tests import the compiled package rather
than its source, so coverage could just as easily have described the build
output — in which case every line number the gate reasons about would refer to
a file nobody wrote and the whole mechanism would be decorative.

So this runs one probe, for a bug already known to be real, and looks at where
the coverage actually landed before anything is built on top of it.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 2: Claims — parse the corpus

**Files:**
- Create: `packages/v3/gate/package.json`
- Create: `packages/v3/gate/src/types.ts`
- Create: `packages/v3/gate/src/claims.ts`
- Test: `packages/v3/gate/src/claims.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `loadClaims(path: string): Claim[]`, and every type in `types.ts`.

- [ ] **Step 1: Create the package manifest**

`packages/v3/gate/package.json`:

```json
{
  "name": "@mycelium/gate",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "The verify gate: tells a real finding from a plausible one",
  "scripts": {
    "test": "vitest --run",
    "gate": "node src/cli.ts"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

Then `pnpm install` from the repo root.

- [ ] **Step 2: Write every shared type**

`packages/v3/gate/src/types.ts`:

```ts
/** A claim is a GAP or a CONTRADICTION from the cold pass. Not a proposition. */
export interface Claim {
  id: string; // 'G1'..'G14', 'C1'..'C8'
  kind: 'gap' | 'contradiction';
  witness: string;
  whyItMatters: string;
  propositionA?: string;
  propositionB?: string;
}

/** Lines of a source file a probe DECLARES it will execute. A falsifiable claim. */
export interface ReachTarget {
  file: string; // repo-relative within hive, e.g. 'packages/core/src/lib/event-store.ts'
  lines: number[];
}

export interface Probe {
  claimId: string;
  probe: string; // the vitest source
  reaches: ReachTarget[];
}

/** What running one probe did. */
export type RunOutcome =
  | { kind: 'passed' }
  | { kind: 'assertion-failed'; message: string }
  | { kind: 'errored'; message: string };

/** file -> the set of line numbers that actually executed. */
export type CoverageMap = Map<string, Set<number>>;

export type Verdict = 'CONFIRMED' | 'REFUTED' | 'UNREACHABLE' | 'INVALID';

export interface ReachCheck {
  target: ReachTarget;
  hit: number[];
  missed: number[];
  satisfied: boolean;
}

export interface Result {
  claim: Claim;
  verdict: Verdict;
  reason: string;
  reach: ReachCheck[];
}
```

- [ ] **Step 3: Write the failing test**

`packages/v3/gate/src/claims.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadClaims } from './claims.ts';

const CORPUS = new URL(
  '../../experiments/blind-test/cold-pass-output.json',
  import.meta.url,
).pathname;

describe('loadClaims', () => {
  it('finds exactly the 22 claims: 14 gaps and 8 contradictions', () => {
    const claims = loadClaims(CORPUS);
    expect(claims).toHaveLength(22);
    expect(claims.filter(c => c.kind === 'gap')).toHaveLength(14);
    expect(claims.filter(c => c.kind === 'contradiction')).toHaveLength(8);
  });

  it('ids gaps and contradictions by index, stably', () => {
    const ids = loadClaims(CORPUS).map(c => c.id);
    expect(ids[0]).toBe('G1');
    expect(ids[13]).toBe('G14');
    expect(ids[14]).toBe('C1');
    expect(ids[21]).toBe('C8');
  });

  it('carries the answer-key claims through with their witnesses intact', () => {
    const byId = new Map(loadClaims(CORPUS).map(c => [c.id, c]));
    expect(byId.get('C4')!.witness).toContain("'confidence', '95'");
    expect(byId.get('G1')!.witness).toContain('Fresh clone');
    expect(byId.get('C1')!.witness).toContain('INCREMENTAL path');
  });

  it('survives the ```json fences the cold pass actually emitted', () => {
    // The corpus file is NOT valid JSON as it sits on disk. If this throws,
    // the fence-stripping is broken.
    expect(() => loadClaims(CORPUS)).not.toThrow();
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
pnpm exec vitest run src/claims.test.ts
```

Expected: FAIL — `Failed to resolve import "./claims.ts"`.

- [ ] **Step 5: Implement**

`packages/v3/gate/src/claims.ts`:

```ts
import { readFileSync } from 'node:fs';
import type { Claim } from './types.ts';

/**
 * The cold pass emitted its JSON inside a ```json fence, so the corpus file is
 * not valid JSON as it sits on disk. Strip the fence before parsing.
 */
function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?\s*\n/, '')
    .replace(/\n```\s*$/, '')
    .trim();
}

interface RawGap {
  witness: string;
  why_it_matters: string;
}
interface RawContradiction extends RawGap {
  proposition_a?: string;
  proposition_b?: string;
}

/**
 * The 22 CLAIMS are the gaps and contradictions. The 29 propositions are the
 * module's contract — context for probing, never something to verify.
 *
 * Gaps and contradictions carry no id of their own, so they are numbered by
 * array index. That is stable because the corpus file is frozen.
 */
export function loadClaims(path: string): Claim[] {
  const parsed = JSON.parse(stripFences(readFileSync(path, 'utf8'))) as {
    gaps: RawGap[];
    contradictions: RawContradiction[];
  };

  const gaps: Claim[] = parsed.gaps.map((g, i) => ({
    id: `G${i + 1}`,
    kind: 'gap',
    witness: g.witness,
    whyItMatters: g.why_it_matters,
  }));

  const contradictions: Claim[] = parsed.contradictions.map((c, i) => ({
    id: `C${i + 1}`,
    kind: 'contradiction',
    witness: c.witness,
    whyItMatters: c.why_it_matters,
    propositionA: c.proposition_a,
    propositionB: c.proposition_b,
  }));

  return [...gaps, ...contradictions];
}
```

- [ ] **Step 6: Run it and watch it pass**

```bash
pnpm exec vitest run src/claims.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/gate
git commit -F - <<'EOF'
feat(gate): read the twenty-two claims out of the cold pass

The claims to verify are the gaps and the contradictions — the places the model
said the module's behaviour is unspecified, or specified twice and
incompatibly. The propositions it also produced are the module's contract, and
they are context for writing a probe rather than anything to be checked, so
they are read but never verified.

Neither gaps nor contradictions carry an identifier of their own, so they are
numbered by position, which is stable because the corpus file is frozen. The
file is also not valid JSON: the model wrapped its answer in a code fence and
nobody unwrapped it before saving. That is stripped here rather than by hand,
so the corpus stays exactly as the model produced it.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 3: The gate itself — coverage, reach, and the four verdicts

This is the product. It is pure, so it gets tested hard and fast.

**Files:**
- Create: `packages/v3/gate/src/coverage.ts`
- Create: `packages/v3/gate/src/verdict.ts`
- Test: `packages/v3/gate/src/verdict.test.ts`

**Interfaces:**
- Consumes: `Claim`, `ReachTarget`, `RunOutcome`, `CoverageMap`, `Verdict`, `ReachCheck` from `types.ts`.
- Produces:
  - `parseCoverage(coverageFinalPath: string, hiveRoot: string): CoverageMap`
  - `checkReach(targets: ReachTarget[], covered: CoverageMap): ReachCheck[]`
  - `decide(outcome: RunOutcome, reach: ReachCheck[]): { verdict: Verdict; reason: string }`

- [ ] **Step 1: Write the failing test**

`packages/v3/gate/src/verdict.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { checkReach, decide } from './verdict.ts';
import type { CoverageMap, ReachTarget } from './types.ts';

const EVENT_STORE = 'packages/core/src/lib/event-store.ts';
const target = (lines: number[]): ReachTarget => ({ file: EVENT_STORE, lines });

const covering = (lines: number[]): CoverageMap =>
  new Map([[EVENT_STORE, new Set(lines)]]);

describe('checkReach', () => {
  it('is satisfied when at least one declared line executed', () => {
    const [check] = checkReach([target([100, 101, 102])], covering([101]));
    expect(check.satisfied).toBe(true);
    expect(check.hit).toEqual([101]);
    expect(check.missed).toEqual([100, 102]);
  });

  it('is NOT satisfied when none of the declared lines executed', () => {
    const [check] = checkReach([target([677, 678])], covering([100]));
    expect(check.satisfied).toBe(false);
    expect(check.hit).toEqual([]);
  });

  it('is NOT satisfied when the declared file never loaded at all', () => {
    const [check] = checkReach([target([100])], new Map());
    expect(check.satisfied).toBe(false);
  });

  it('requires EVERY target to be satisfied, not just one of them', () => {
    const checks = checkReach(
      [target([100]), target([677])],
      covering([100]),
    );
    expect(checks.map(c => c.satisfied)).toEqual([true, false]);
  });
});

describe('decide — the four verdicts', () => {
  const reached = checkReach([target([100])], covering([100]));
  const notReached = checkReach([target([677])], covering([100]));

  it('CONFIRMED: the probe failed on its assertion AND reached the code', () => {
    const { verdict } = decide(
      { kind: 'assertion-failed', message: "AssertionError: expected '95' not to be '95'" },
      reached,
    );
    expect(verdict).toBe('CONFIRMED');
  });

  it('REFUTED: the probe passed AND reached the code', () => {
    expect(decide({ kind: 'passed' }, reached).verdict).toBe('REFUTED');
  });

  it('UNREACHABLE: the probe passed but executed none of the code it named', () => {
    // THE BUG THIS GATE EXISTS FOR. Two of three hand-written probes did exactly
    // this last session, and a pass/fail gate would have called them REFUTED.
    expect(decide({ kind: 'passed' }, notReached).verdict).toBe('UNREACHABLE');
  });

  it('UNREACHABLE: a probe that FAILS but reached nothing is not a confirmation', () => {
    const { verdict } = decide(
      { kind: 'assertion-failed', message: 'AssertionError: nope' },
      notReached,
    );
    expect(verdict).toBe('UNREACHABLE');
  });

  it('INVALID: the probe errored — the GATE failed, not the claim', () => {
    const { verdict } = decide(
      { kind: 'errored', message: 'TypeError: ctx.fs.mkdirSync is not a function' },
      reached,
    );
    expect(verdict).toBe('INVALID');
  });

  it('INVALID beats reach: an errored probe is never a finding, however much it covered', () => {
    expect(decide({ kind: 'errored', message: 'boom' }, reached).verdict).toBe('INVALID');
    expect(decide({ kind: 'errored', message: 'boom' }, notReached).verdict).toBe('INVALID');
  });

  it('gives a reason naming the lines that were missed', () => {
    const { reason } = decide({ kind: 'passed' }, notReached);
    expect(reason).toContain('677');
    expect(reason).toContain(EVENT_STORE);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
pnpm exec vitest run src/verdict.test.ts
```

Expected: FAIL — `Failed to resolve import "./verdict.ts"`.

- [ ] **Step 3: Implement coverage parsing**

`packages/v3/gate/src/coverage.ts`:

```ts
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { CoverageMap } from './types.ts';

/**
 * vitest's v8 provider writes coverage-final.json in istanbul's shape:
 *
 *   { "<abs path>": { path, statementMap: { "0": {start:{line},end:{line}} }, s: { "0": hits } } }
 *
 * A line counts as executed if any statement covering it has a non-zero hit count.
 * Paths are absolute; they are rebased onto hiveRoot so a reach target can be
 * written the way a human would write it: 'packages/core/src/lib/event-store.ts'.
 */
export function parseCoverage(coverageFinalPath: string, hiveRoot: string): CoverageMap {
  const raw = JSON.parse(readFileSync(coverageFinalPath, 'utf8')) as Record<
    string,
    {
      path: string;
      statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
      s: Record<string, number>;
    }
  >;

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
```

- [ ] **Step 4: Implement reach and the four verdicts**

`packages/v3/gate/src/verdict.ts`:

```ts
import type { CoverageMap, ReachCheck, ReachTarget, RunOutcome, Verdict } from './types.ts';

/**
 * A target is SATISFIED if at least one of its declared lines executed.
 *
 * Why not require ALL of them: a model declaring a range will include closing
 * braces and blank lines, which v8 never reports as executed. Demanding every
 * line would reject honest probes — and the commit-msg hook already taught us
 * that a gate's dangerous failure mode is the FALSE REJECTION, because it
 * teaches people to route around the gate.
 *
 * At-least-one is enough to catch the lie this gate exists for: when a probe
 * never runs the code it named, the count is ZERO, not low. The hit ratio is
 * reported regardless, so a suspiciously thin overlap stays visible.
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
 * The gate.
 *
 * A probe can lie in BOTH directions, so reach is a precondition on every
 * verdict rather than a filter at the end:
 *
 *   it failed  -> the claim is real ... unless it threw in bootstrap,
 *                 or never ran the code it named
 *   it passed  -> the claim is false ... unless it ran nothing at all
 *
 * INVALID is checked first: an errored probe tells you nothing about the claim,
 * however much of the file it happened to touch on its way down.
 */
export function decide(
  outcome: RunOutcome,
  reach: ReachCheck[],
): { verdict: Verdict; reason: string } {
  if (outcome.kind === 'errored') {
    return {
      verdict: 'INVALID',
      reason: `the probe errored outside its assertion — the gate failed, not the claim: ${outcome.message}`,
    };
  }

  if (reach.length === 0) {
    return { verdict: 'INVALID', reason: 'the probe declared no reach target, so nothing could be checked' };
  }

  const unmet = reach.filter(r => !r.satisfied);
  if (unmet.length > 0) {
    const where = unmet
      .map(r => `${r.target.file}:${r.target.lines.join(',')}`)
      .join('; ');
    return {
      verdict: 'UNREACHABLE',
      reason: `the probe ran, but none of the lines it named executed (${where}) — the code is unreachable under this test harness, so the claim cannot be tested here`,
    };
  }

  if (outcome.kind === 'assertion-failed') {
    return {
      verdict: 'CONFIRMED',
      reason: `the probe reached the code and failed on its assertion: ${outcome.message.split('\n')[0]}`,
    };
  }

  return {
    verdict: 'REFUTED',
    reason: 'the probe reached the code and passed — the claim does not hold',
  };
}
```

- [ ] **Step 5: Run it and watch it pass**

```bash
pnpm exec vitest run src/verdict.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/gate
git commit -F - <<'EOF'
feat(gate): judge a probe by what it touched, not by whether it passed

A probe that fails is supposed to mean the claim it was written against is
real, and a probe that passes is supposed to mean the claim is false. Both
readings are wrong on their own. A failing probe may have thrown while setting
itself up and never have got as far as its assertion. A passing probe may have
executed none of the code it was written about, which is what two of the three
probes written by hand last session turned out to do — they were green, and
they were green because they were testing nothing.

So the probe is made to say in advance which lines it intends to run, and
coverage is used to check whether it did. Only then is passing or failing read
at all, and four outcomes fall out rather than two: the claim holds, the claim
does not hold, the code was never reached, or the probe was broken. The third
is a finding about the test harness rather than a failure of the gate, and the
fourth keeps the gate's own bugs from being reported as discoveries.

A line counts as reached if any line the probe named ran. Demanding all of them
would reject honest probes over blank lines and closing braces, and a gate that
rejects honest work is one people learn to bypass.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 4: The worktree

**Files:**
- Create: `packages/v3/gate/src/worktree.ts`
- Test: `packages/v3/gate/src/worktree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ensureWorktree(opts: { hiveRepo: string; sha: string; root: string }): Promise<string>` — returns the absolute path to a ready worktree. Idempotent: if the worktree exists and is prepared, it returns immediately.

- [ ] **Step 1: Write the failing test**

`packages/v3/gate/src/worktree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureWorktree, HIVE_SHA } from './worktree.ts';

const HIVE = '/Users/bigmistqke/Documents/GitHub/hive';
const ROOT = '/Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees';

describe('ensureWorktree', () => {
  it('pins to the SHA the cold pass actually read', () => {
    expect(HIVE_SHA).toBe('5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9');
  });

  it('produces a worktree with core built and the coverage provider installed', async () => {
    const dir = await ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT });
    expect(existsSync(join(dir, 'packages/core/dist/lib/event-store.js'))).toBe(true);
    expect(existsSync(join(dir, 'node_modules'))).toBe(true);
    expect(existsSync(join(dir, 'packages/tests/vitest.gate.config.ts'))).toBe(true);
  }, 300_000);

  it('is idempotent — a second call is fast and returns the same path', async () => {
    const a = await ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT });
    const started = performance.now();
    const b = await ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT });
    expect(b).toBe(a);
    expect(performance.now() - started).toBeLessThan(2000); // no reinstall
  }, 300_000);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
pnpm exec vitest run src/worktree.test.ts
```

Expected: FAIL — `Failed to resolve import "./worktree.ts"`.

- [ ] **Step 3: Implement**

`packages/v3/gate/src/worktree.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * hive's HEAD, and the exact tree the cold pass read: event-store.ts last
 * changed two commits earlier, at 5aade99. Never run against a moving HEAD —
 * a verdict that cannot be reproduced is not a verdict.
 */
export const HIVE_SHA = '5d52a98e2c89a50c4c035a1399fe3fec6c05f7b9';

/** The vitest config the gate supplies. One probe, coverage on, hive's own suite excluded. */
const GATE_CONFIG = `import { defineConfig } from 'vitest/config';

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
`;

const sh = (cmd: string, args: string[], cwd: string) =>
  execFileSync(cmd, args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * A disposable, pinned, CACHED worktree of hive.
 *
 * Cached because `pnpm install` in a fresh worktree is the slow part and it is
 * identical every time. Pinned because "CONFIRMED against hive" is not a claim
 * you can make about a moving branch.
 *
 * Any failure here throws. An infrastructure failure must never be laundered
 * into twenty-two INVALID verdicts — that would be the gate lying about itself.
 */
export async function ensureWorktree(opts: {
  hiveRepo: string;
  sha: string;
  root: string;
}): Promise<string> {
  const dir = join(opts.root, `hive-${opts.sha.slice(0, 7)}`);
  const stamp = join(dir, '.gate-ready');

  if (existsSync(stamp)) return dir;

  mkdirSync(opts.root, { recursive: true });

  if (!existsSync(dir)) {
    sh('git', ['worktree', 'add', '--detach', dir, opts.sha], opts.hiveRepo);
  }

  sh('pnpm', ['install'], dir);
  sh('pnpm', ['build:core'], dir);
  sh('pnpm', ['--filter', '@hive/tests', 'add', '-D', '@vitest/coverage-v8@^1.0.0'], dir);

  writeFileSync(join(dir, 'packages/tests/vitest.gate.config.ts'), GATE_CONFIG);
  writeFileSync(stamp, `${opts.sha}\n`);

  return dir;
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run src/worktree.test.ts
```

Expected: PASS, 3 tests. The second may take minutes on a cold cache — that is the install, and it happens once.

- [ ] **Step 5: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/gate
git commit -F - <<'EOF'
feat(gate): run probes against a pinned, disposable copy of hive

Probes are files written into someone else's repository and then executed
there, which is not something to do to a working tree you did not create. They
go into a git worktree instead, so hive is never touched and a crashed run
leaves nothing behind to clean up.

The worktree is pinned to the commit the model actually read when it made these
claims, because a finding reported against a moving branch is one nobody can
reproduce later — including us. It is also cached between runs: installing
dependencies into a fresh worktree is the slow part of the whole gate and it
produces the same tree every time.

Anything that goes wrong in here throws rather than being recorded against the
claims. If installing dependencies fails, that is the gate being broken, and
reporting it as twenty-two claims that could not be verified would be the gate
lying about itself.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 5: Run one probe

**Files:**
- Create: `packages/v3/gate/src/run.ts`
- Test: `packages/v3/gate/src/run.test.ts`

**Interfaces:**
- Consumes: `ensureWorktree`, `HIVE_SHA` from `worktree.ts`; `parseCoverage` from `coverage.ts`; `RunOutcome`, `CoverageMap` from `types.ts`.
- Produces: `runProbe(opts: { worktree: string; claimId: string; source: string }): Promise<{ outcome: RunOutcome; covered: CoverageMap }>`

- [ ] **Step 1: Write the failing test**

Three probes with known behaviour: one that fails on an assertion, one that passes, one that throws. This pins the `assertion-failed` vs `errored` distinction, which is the subtlest part of the whole gate.

`packages/v3/gate/src/run.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureWorktree, HIVE_SHA } from './worktree.ts';
import { runProbe } from './run.ts';

const HIVE = '/Users/bigmistqke/Documents/GitHub/hive';
const ROOT = '/Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees';

let worktree: string;
beforeAll(async () => {
  worktree = await ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT });
}, 300_000);

describe('runProbe', () => {
  it('reports an expect() failure as assertion-failed, not as an error', async () => {
    const { outcome } = await runProbe({
      worktree,
      claimId: 'FIXTURE-assert',
      source: `
        import { describe, it, expect } from 'vitest';
        describe('x', () => { it('y', () => { expect(1).toBe(2); }); });
      `,
    });
    expect(outcome.kind).toBe('assertion-failed');
  }, 120_000);

  it('reports a passing probe as passed', async () => {
    const { outcome } = await runProbe({
      worktree,
      claimId: 'FIXTURE-pass',
      source: `
        import { describe, it, expect } from 'vitest';
        describe('x', () => { it('y', () => { expect(1).toBe(1); }); });
      `,
    });
    expect(outcome.kind).toBe('passed');
  }, 120_000);

  it('reports a throw as errored — this is what stops "my setup broke" being read as "I found a bug"', async () => {
    const { outcome } = await runProbe({
      worktree,
      claimId: 'FIXTURE-throw',
      source: `
        import { describe, it } from 'vitest';
        describe('x', () => { it('y', () => { (undefined as any).nope(); }); });
      `,
    });
    expect(outcome.kind).toBe('errored');
  }, 120_000);

  it('collects coverage of hive core when the probe imports it', async () => {
    const { covered } = await runProbe({
      worktree,
      claimId: 'FIXTURE-cov',
      source: `
        import { describe, it, expect } from 'vitest';
        import { createTestContext } from '@hive/core';
        describe('x', () => {
          it('y', async () => { expect(await createTestContext('/r')).toBeTruthy(); });
        });
      `,
    });
    const files = [...covered.keys()];
    expect(files.some(f => f.includes('core') && f.includes('event-store'))).toBe(true);
  }, 120_000);
});
```

Note: if Task 1 landed on Plan B (alias to source), the last assertion still holds — the file key just ends `.ts` instead of `.js`. It asserts on `includes`, not on the extension, deliberately.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
pnpm exec vitest run src/run.test.ts
```

Expected: FAIL — `Failed to resolve import "./run.ts"`.

- [ ] **Step 3: Implement**

`packages/v3/gate/src/run.ts`:

```ts
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseCoverage } from './coverage.ts';
import type { CoverageMap, RunOutcome } from './types.ts';

const exec = promisify(execFile);

interface VitestJson {
  testResults?: Array<{
    assertionResults?: Array<{ status: string; failureMessages?: string[] }>;
    message?: string;
    status?: string;
  }>;
}

/**
 * An expect() failure surfaces as an AssertionError. Anything else the probe
 * throws — a TypeError, an fs error, a failed import — is the PROBE being
 * broken, not the claim being true.
 *
 * This is the check that stops "my setup threw" from being reported as "I found
 * a bug", which is the false-positive mirror of the probe that passes while
 * testing nothing.
 */
function classify(json: VitestJson, stderr: string): RunOutcome {
  const results = json.testResults ?? [];
  const assertions = results.flatMap(r => r.assertionResults ?? []);

  // No test ran at all: a transform error, an unresolved import, a syntax error.
  if (assertions.length === 0) {
    const msg = results.map(r => r.message).filter(Boolean).join('\n') || stderr;
    return { kind: 'errored', message: msg.slice(0, 2000) || 'the probe produced no test results' };
  }

  const failed = assertions.filter(a => a.status === 'failed');
  if (failed.length === 0) return { kind: 'passed' };

  const messages = failed.flatMap(a => a.failureMessages ?? []).join('\n');
  const isAssertion = /AssertionError/.test(messages);

  return isAssertion
    ? { kind: 'assertion-failed', message: messages.slice(0, 2000) }
    : { kind: 'errored', message: messages.slice(0, 2000) };
}

/**
 * Run ONE probe, alone, in the pinned worktree.
 *
 * Alone for two reasons: coverage is then attributable to this probe and
 * nothing else, and a probe that crashes cannot take the other twenty-one down
 * with it. hive's own 162 tests are never run.
 */
export async function runProbe(opts: {
  worktree: string;
  claimId: string;
  source: string;
}): Promise<{ outcome: RunOutcome; covered: CoverageMap }> {
  const testsPkg = join(opts.worktree, 'packages/tests');
  const rel = `src/gate-${opts.claimId}.test.ts`;
  const probePath = join(testsPkg, rel);
  const covDir = join(opts.worktree, '.gate', opts.claimId, 'coverage');
  const resultPath = join(opts.worktree, '.gate', opts.claimId, 'result.json');

  mkdirSync(join(opts.worktree, '.gate', opts.claimId), { recursive: true });
  writeFileSync(probePath, opts.source);

  let stdout = '';
  let stderr = '';
  try {
    const r = await exec(
      'pnpm',
      [
        'exec', 'vitest', 'run',
        '--config', 'vitest.gate.config.ts',
        '--reporter=json',
        `--outputFile=${resultPath}`,
      ],
      {
        cwd: testsPkg,
        env: { ...process.env, GATE_PROBE: rel, GATE_COV: covDir, MISE_DISABLE_HOOKS: '1' },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (e: any) {
    // A failing test makes vitest exit non-zero. That is data, not an error.
    stdout = e?.stdout ?? '';
    stderr = e?.stderr ?? String(e);
  } finally {
    rmSync(probePath, { force: true });
  }

  let json: VitestJson = {};
  if (existsSync(resultPath)) {
    try {
      json = JSON.parse(readFileSync(resultPath, 'utf8')) as VitestJson;
    } catch {
      /* leave json empty; classify() will call it errored */
    }
  }

  const outcome = classify(json, stderr || stdout);

  const covFile = join(covDir, 'coverage-final.json');
  const covered = existsSync(covFile)
    ? parseCoverage(covFile, opts.worktree)
    : (new Map() as CoverageMap);

  return { outcome, covered };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run src/run.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/gate
git commit -F - <<'EOF'
feat(gate): run one probe alone and tell a broken probe from a real finding

Probes run one at a time rather than as a suite. Coverage is then attributable
to the single probe that produced it, and a probe that crashes cannot take the
other twenty-one down with it. hive's own tests are never run at all — the gate
has no business executing them and no way to interpret the result if it did.

The subtle part is reading the outcome. A probe is written to fail if its claim
is true, so a failure looks like a discovery. But a probe can also fail because
it threw while setting itself up, and that failure says nothing about the claim
at all. An assertion that does not hold raises a recognisably different error
from a null dereference or an import that did not resolve, so that is the line
drawn here: an assertion failing means the claim survived, and anything else
means the probe was broken.

Without that distinction the gate would eventually report its own bugs as
discoveries, which is the one thing it may never do.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 6: The probe generator — the only LLM in the gate

**Files:**
- Create: `packages/v3/gate/prompts/probe.md`
- Create: `packages/v3/gate/src/probe.ts`
- Test: `packages/v3/gate/src/probe.test.ts`

**Interfaces:**
- Consumes: `Claim`, `Probe` from `types.ts`.
- Produces:
  - `buildPrompt(claim: Claim, propositions: string): string`
  - `generateProbe(claim: Claim, opts: { cacheDir: string; propositions: string }): Promise<Probe>`

- [ ] **Step 1: Write the prompt template**

The prompt hands the model the bootstrap helper verbatim so it does not have to invent one. Most `INVALID` verdicts would otherwise come from a re-invented fixture, and that is a prompt problem, not a finding.

`packages/v3/gate/prompts/probe.md`:

````markdown
You are writing ONE falsification probe for ONE claim about hive's event store.

The claim was produced by a model reading `packages/core/src/lib/event-store.ts`.
It asserts that the module's behaviour is either UNSPECIFIED (a gap) or SPECIFIED
TWICE AND INCOMPATIBLY (a contradiction). Your job is to find out whether it is true.

## The claim

KIND: {{KIND}}
WITNESS: {{WITNESS}}
WHY IT MATTERS: {{WHY}}

## The module's contract, as the same model described it

{{PROPOSITIONS}}

## Your job

Write a SINGLE vitest test that **FAILS if the claim is TRUE**.

You are trying to falsify the claim. Assert the behaviour that SHOULD hold. If the
claim is real, your assertion will not hold and the test will fail — and that failure
is the finding.

Do NOT write a test that asserts the buggy behaviour and passes. That inverts the
polarity and makes the bug look like the spec.

## Rules

- ONE `describe`, ONE `it`. No extra cases. No "while I'm here" assertions.
- The failure must come from `expect()`, not from a throw. A probe that dies in
  setup proves nothing, and will be discarded.
- Import only from `vitest`, `isomorphic-git`, and `@hive/core`.
- Use the bootstrap helpers below VERBATIM. Do not invent your own fixture.

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
```

## Declare what you will execute

Alongside the probe, name the lines of `packages/core/src/lib/event-store.ts` that
your probe will actually cause to run — the lines where the claimed behaviour lives.

This is checked against real coverage. **If none of the lines you name execute, your
probe is discarded**, whatever it did. Do not name lines you hope are involved. Name
the lines the claim is about, and make sure your probe runs them.

Read the file before answering. Line numbers must be from the version on disk.

## Output

JSON ONLY. No prose. No code fence.

{
  "probe": "<the complete .test.ts file, as a string>",
  "reaches": [
    { "file": "packages/core/src/lib/event-store.ts", "lines": [120, 121, 122] }
  ]
}
````

- [ ] **Step 2: Write the failing test**

`generateProbe` shells out to `claude`, so the test covers what is deterministic: prompt construction, fence-tolerant parsing, and the cache.

`packages/v3/gate/src/probe.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPrompt, parseProbeResponse, generateProbe } from './probe.ts';
import type { Claim } from './types.ts';

const claim: Claim = {
  id: 'C4',
  kind: 'contradiction',
  witness: "recordStateTransition(ctx, G, 'confidence', '95', 'hive-local').",
  whyItMatters: 'The write path and the rebuild path disagree about what a commit MEANS.',
};

describe('buildPrompt', () => {
  it('substitutes the claim into the template', () => {
    const p = buildPrompt(claim, '(propositions here)');
    expect(p).toContain("recordStateTransition(ctx, G, 'confidence', '95', 'hive-local').");
    expect(p).toContain('contradiction');
    expect(p).toContain('(propositions here)');
    expect(p).not.toContain('{{WITNESS}}');
    expect(p).not.toContain('{{PROPOSITIONS}}');
  });
});

describe('parseProbeResponse', () => {
  const body = JSON.stringify({
    probe: "import { it } from 'vitest';",
    reaches: [{ file: 'packages/core/src/lib/event-store.ts', lines: [120] }],
  });

  it('parses a bare JSON response', () => {
    const p = parseProbeResponse('C4', body);
    expect(p.reaches[0].lines).toEqual([120]);
  });

  it('parses a fenced response, because the cold pass emitted one despite being told not to', () => {
    const p = parseProbeResponse('C4', '```json\n' + body + '\n```');
    expect(p.reaches[0].lines).toEqual([120]);
  });

  it('throws on a response with no JSON in it at all', () => {
    expect(() => parseProbeResponse('C4', "Sure! Here's what I think...")).toThrow();
  });
});

describe('generateProbe caching', () => {
  it('returns the cached probe without calling the model', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'gate-cache-'));
    const cached = {
      claimId: 'C4',
      probe: 'CACHED',
      reaches: [{ file: 'packages/core/src/lib/event-store.ts', lines: [120] }],
    };
    writeFileSync(join(cacheDir, 'C4.json'), JSON.stringify(cached));

    const p = await generateProbe(claim, { cacheDir, propositions: 'x' });
    expect(p.probe).toBe('CACHED');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
pnpm exec vitest run src/probe.test.ts
```

Expected: FAIL — `Failed to resolve import "./probe.ts"`.

- [ ] **Step 4: Implement**

`packages/v3/gate/src/probe.ts`:

```ts
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Claim, Probe } from './types.ts';

const exec = promisify(execFile);

const TEMPLATE = new URL('../prompts/probe.md', import.meta.url).pathname;

export function buildPrompt(claim: Claim, propositions: string): string {
  return readFileSync(TEMPLATE, 'utf8')
    .replace('{{KIND}}', claim.kind)
    .replace('{{WITNESS}}', claim.witness)
    .replace('{{WHY}}', claim.whyItMatters)
    .replace('{{PROPOSITIONS}}', propositions);
}

/**
 * The prompt says "no code fence". The cold pass was told the same thing and
 * emitted one anyway — see cold-pass-output.json, whose first line is ```json.
 * Tolerate it rather than lose the run over punctuation.
 */
export function parseProbeResponse(claimId: string, raw: string): Probe {
  const cleaned = raw
    .replace(/^[\s\S]*?```(?:json)?\s*\n/, m => (m.includes('```') ? '' : m))
    .replace(/\n```[\s\S]*$/, '')
    .trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error(`probe response for ${claimId} contained no JSON object`);
  }

  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as {
    probe: string;
    reaches: Array<{ file: string; lines: number[] }>;
  };

  if (!parsed.probe || !Array.isArray(parsed.reaches)) {
    throw new Error(`probe response for ${claimId} is missing probe or reaches`);
  }

  return { claimId, probe: parsed.probe, reaches: parsed.reaches };
}

/**
 * One bounded call per claim. "Write the single probe that fails if this claim
 * is true, and declare the lines it touches" has one right answer and no room
 * to pad — the model is never asked the unbounded question.
 *
 * Cached to disk: a re-run costs no tokens, and every verdict stays replayable
 * against the exact probe that produced it. claude -p is not deterministic, so
 * without this a verdict could not be reproduced even in principle.
 */
export async function generateProbe(
  claim: Claim,
  opts: { cacheDir: string; propositions: string; retries?: number },
): Promise<Probe> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const cached = join(opts.cacheDir, `${claim.id}.json`);

  if (existsSync(cached)) {
    return JSON.parse(readFileSync(cached, 'utf8')) as Probe;
  }

  const prompt = buildPrompt(claim, opts.propositions);
  const attempts = (opts.retries ?? 1) + 1;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await exec('claude', ['-p', prompt], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
        cwd: '/Users/bigmistqke/Documents/GitHub/hive',
      });
      const probe = parseProbeResponse(claim.id, stdout);
      writeFileSync(cached, JSON.stringify(probe, null, 2));
      return probe;
    } catch (e) {
      lastError = e;
    }
  }

  throw new Error(`could not generate a probe for ${claim.id}: ${String(lastError)}`);
}
```

Note the `cwd`: the model is told to read `event-store.ts` for line numbers, so it must be run inside hive.

- [ ] **Step 5: Run it and watch it pass**

```bash
pnpm exec vitest run src/probe.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Sanity-check the real thing on one claim**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
node --input-type=module -e "
import { loadClaims } from './src/claims.ts';
import { generateProbe } from './src/probe.ts';
const claims = loadClaims('../experiments/blind-test/cold-pass-output.json');
const c4 = claims.find(c => c.id === 'C4');
const p = await generateProbe(c4, { cacheDir: './probes', propositions: '(omitted)' });
console.log('reaches:', JSON.stringify(p.reaches));
console.log(p.probe.slice(0, 400));
"
```

Expected: a probe importing `@hive/core`, and `reaches` naming lines in `event-store.ts`. If it names lines nowhere near the claim, the prompt needs work — fix the prompt, not the gate.

- [ ] **Step 7: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/gate
git commit -F - <<'EOF'
feat(gate): ask the model for one probe and make it say what it will run

This is the only place a model is consulted, and it is asked the narrowest
question the gate can pose: given this one claim, write the single test that
fails if the claim is true. There is one right answer to that and no room to
pad it, which is the whole reason the question is shaped this way. Asked to
write tests for a module, a model produces plausible tests until it feels done,
because nothing in the request says when to stop.

It must also declare which lines of the module its probe will execute. That
declaration is checked against real coverage afterwards, so it is a claim the
model can be caught making falsely — the same reason the commit hook checks a
cited decision against the files a commit actually changed. A model asked to
cite something will cite something; the check is what makes a false citation
expensive to construct.

The fixture the probe builds on is handed over verbatim rather than left to be
reinvented, since a probe that dies in its own setup teaches nobody anything.
Answers are kept on disk, because the model is not deterministic and a verdict
you cannot reproduce is not a verdict.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

---

## Task 7: Report, CLI, and the answer-key regression

The gate's own verification. This is the task that decides whether any of it worked.

**Files:**
- Create: `packages/v3/gate/src/report.ts`
- Create: `packages/v3/gate/src/cli.ts`
- Test: `packages/v3/gate/src/answer-key.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `verifyClaim(...)`, `formatReport(results: Result[]): string`, and a CLI at `node src/cli.ts`.

- [ ] **Step 1: Implement the report**

`packages/v3/gate/src/report.ts`:

```ts
import type { Result, Verdict } from './types.ts';

const ORDER: Verdict[] = ['CONFIRMED', 'UNREACHABLE', 'REFUTED', 'INVALID'];

export function tally(results: Result[]): Record<Verdict, number> {
  const t: Record<Verdict, number> = { CONFIRMED: 0, REFUTED: 0, UNREACHABLE: 0, INVALID: 0 };
  for (const r of results) t[r.verdict]++;
  return t;
}

export function formatReport(results: Result[]): string {
  const t = tally(results);
  const lines: string[] = [];

  lines.push('');
  lines.push(`  ${results.length} claims, verified against hive`);
  lines.push('');

  for (const verdict of ORDER) {
    const group = results.filter(r => r.verdict === verdict);
    if (group.length === 0) continue;
    lines.push(`  ${verdict}  (${group.length})`);
    for (const r of group) {
      lines.push(`    ${r.claim.id}  ${r.claim.witness.split('\n')[0].slice(0, 90)}`);
      lines.push(`         ${r.reason.slice(0, 110)}`);
    }
    lines.push('');
  }

  lines.push('  ─────────────────────────────────────────────');
  lines.push(
    `  ${t.CONFIRMED} confirmed · ${t.UNREACHABLE} unreachable · ${t.REFUTED} refuted · ${t.INVALID} invalid`,
  );
  lines.push('');

  if (t.INVALID > results.length / 4) {
    lines.push('  ⚠ a quarter of the probes did not run. That is a verdict on the PROMPT,');
    lines.push('    not on the claims. Fix the prompt before reading anything above.');
    lines.push('');
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Implement the CLI**

`packages/v3/gate/src/cli.ts`:

```ts
import { readFileSync } from 'node:fs';
import { loadClaims } from './claims.ts';
import { generateProbe } from './probe.ts';
import { runProbe } from './run.ts';
import { checkReach, decide } from './verdict.ts';
import { formatReport } from './report.ts';
import { ensureWorktree, HIVE_SHA } from './worktree.ts';
import type { Claim, Result } from './types.ts';

const HIVE = '/Users/bigmistqke/Documents/GitHub/hive';
const ROOT = new URL('../../../../.mycelium/worktrees', import.meta.url).pathname;
const CORPUS = new URL('../../experiments/blind-test/cold-pass-output.json', import.meta.url).pathname;
const CACHE = new URL('../probes', import.meta.url).pathname;

export async function verifyClaim(
  claim: Claim,
  worktree: string,
  propositions: string,
): Promise<Result> {
  let probe;
  try {
    probe = await generateProbe(claim, { cacheDir: CACHE, propositions });
  } catch (e) {
    return {
      claim,
      verdict: 'INVALID',
      reason: `no probe could be generated: ${String(e)}`,
      reach: [],
    };
  }

  const { outcome, covered } = await runProbe({
    worktree,
    claimId: claim.id,
    source: probe.probe,
  });

  const reach = checkReach(probe.reaches, covered);
  const { verdict, reason } = decide(outcome, reach);
  return { claim, verdict, reason, reach };
}

async function main() {
  // Infrastructure failure aborts. It is never laundered into INVALID verdicts.
  const worktree = await ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT });

  const claims = loadClaims(CORPUS);
  const propositions = readFileSync(CORPUS, 'utf8');

  const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const todo = only.length ? claims.filter(c => only.includes(c.id)) : claims;

  const results: Result[] = [];
  for (const claim of todo) {
    process.stderr.write(`  ${claim.id} … `);
    const result = await verifyClaim(claim, worktree, propositions);
    process.stderr.write(`${result.verdict}\n`);
    results.push(result);
  }

  console.log(formatReport(results));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

- [ ] **Step 3: Write the answer-key regression test**

**This is the test that decides whether the gate works.** Three claims with known ground truth. If `C1` or `G1` comes back `REFUTED`, the gate has reproduced last session's exact mistake and the reach check has failed at the one job it exists for.

`packages/v3/gate/src/answer-key.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadClaims } from './claims.ts';
import { verifyClaim } from './cli.ts';
import { ensureWorktree, HIVE_SHA } from './worktree.ts';

const HIVE = '/Users/bigmistqke/Documents/GitHub/hive';
const ROOT = '/Users/bigmistqke/Documents/GitHub/mycelium/.mycelium/worktrees';
const CORPUS = new URL('../../experiments/blind-test/cold-pass-output.json', import.meta.url).pathname;

let worktree: string;
let propositions: string;
const claims = loadClaims(CORPUS);
const byId = new Map(claims.map(c => [c.id, c]));

beforeAll(async () => {
  worktree = await ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT });
  propositions = readFileSync(CORPUS, 'utf8');
}, 300_000);

describe('the answer key', () => {
  it('C4 is CONFIRMED — a real bug, on a path hive tests DO reach', async () => {
    // A confidence transition re-materializes as a STATUS on rebuild: the node's
    // status literally becomes the string "95". Proven by a failing test last
    // session. It exercises the FULL-REBUILD path, which hive's tests do execute.
    const r = await verifyClaim(byId.get('C4')!, worktree, propositions);
    expect(r.verdict).toBe('CONFIRMED');
  }, 300_000);

  it('C1 is UNREACHABLE, NOT refuted — the incremental path never executes', async () => {
    // hive's test context uses an in-memory fs, so dbExists is permanently false
    // and every one of its 162 tests takes the full-rebuild branch. A probe for
    // this claim passes while executing NOTHING. That is what happened last
    // session, and a pass/fail gate called it refuted.
    const r = await verifyClaim(byId.get('C1')!, worktree, propositions);
    expect(r.verdict).toBe('UNREACHABLE');
    expect(r.verdict).not.toBe('REFUTED');
  }, 300_000);

  it('G1 is UNREACHABLE, NOT refuted — same dead path', async () => {
    const r = await verifyClaim(byId.get('G1')!, worktree, propositions);
    expect(r.verdict).toBe('UNREACHABLE');
    expect(r.verdict).not.toBe('REFUTED');
  }, 300_000);
});
```

- [ ] **Step 4: Run the answer key**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium/packages/v3/gate
pnpm exec vitest run src/answer-key.test.ts
```

Expected: PASS, 3 tests.

**If `C1` or `G1` comes back `REFUTED`: STOP.** Do not tune the assertion to match. The reach check is not working, and the gate is currently worth less than nothing — it is laundering an untested claim as a tested one. Debug `checkReach` and the coverage plumbing until the verdict is honest.

**If `C4` comes back `INVALID`:** the generated probe is broken. Compare it against `experiments/blind-test/probes.test.ts`, which is a probe for this claim that is known to work, and fix the *prompt*.

- [ ] **Step 5: Run the whole corpus**

```bash
node src/cli.ts
```

Expected: 22 verdicts and the number. This is the deliverable.

- [ ] **Step 6: Commit**

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
git add packages/v3/gate
git commit -F - <<'EOF'
feat(gate): verify the twenty-two claims, and check the gate against what we know

The gate now runs end to end and reports what it found. It also checks itself
first, which is the part that matters, because three of these claims already
have known answers and can therefore be used to test the gate rather than
merely be tested by it.

One of the three is a real bug and must come back confirmed. The other two were
probed by hand last session and both probes passed while executing none of the
code they were written about, because the path they need is dead under an
in-memory filesystem and every one of hive's tests takes the other branch. So
those two must come back as unreachable, and if the gate calls either of them
refuted then it has reproduced exactly the mistake it was built to prevent, and
is worth less than nothing — it would be laundering an untested claim as a
tested one.

The naive version of this gate fails that check, which is what makes it a real
test rather than a ceremonial one.

Decision: 1ea16b4a-69ec-4a75-aee5-7c07bfcd35c1
EOF
```

- [ ] **Step 7: Record the number**

```bash
deciduous add outcome "VERIFY GATE SHIPPED. Ran the 22 cold-pass claims against hive@5d52a98: <X> confirmed, <Y> unreachable, <Z> refuted, <W> invalid. ANSWER KEY: C4 CONFIRMED (the real bug), C1 and G1 UNREACHABLE (the two probes that lied last session are now caught rather than scored as refuted). <Note anything surprising in the other 19.>" -c 95 --commit HEAD
deciduous link 368 <id> -r "The goal, delivered"
deciduous link 372 <id> -r "The design, built"
deciduous sync
```

---

## Self-Review

**Spec coverage.** Every section of the spec maps to a task: probe/run/reach/report → Tasks 6/5/3/7; the four verdicts → Task 3; reach targets as a falsifiable declaration → Tasks 6 and 3; the pinned cached worktree → Task 4; fence-stripping and claim ids → Task 2; the source-map risk → Task 1 (with Plan B); failure handling → Task 5 (`classify`) and Task 4 (throws) and Task 7 (`INVALID` on generation failure); the answer key → Task 7. Mutation-reach is explicitly out of scope and stays out.

**Placeholders.** The only `<…>` are in the two `deciduous` commands, where the value is a number the run produces and cannot be known in advance. Every code step contains complete code.

**Type consistency.** `Claim`, `ReachTarget`, `Probe`, `RunOutcome`, `CoverageMap`, `Verdict`, `ReachCheck`, `Result` are defined once in Task 2 and used unchanged. `checkReach` returns `ReachCheck[]`, which `decide` consumes; `parseCoverage` returns `CoverageMap`, which `checkReach` consumes; `runProbe` returns both halves `decide` needs.

**One known coupling:** Task 5's coverage assertion and Task 3's reach targets both assume Task 1 established which path (`src/**` or `dist/**`) coverage attributes to. If Task 1 lands on Plan B, no other task changes — the assertions were written to be extension-agnostic on purpose.
