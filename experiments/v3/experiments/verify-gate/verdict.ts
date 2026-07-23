import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

/** A claim is a GAP or CONTRADICTION from the cold pass. Not a proposition. */
export interface Claim {
  id: string; // 'G1'..'G14', 'C1'..'C8'
  kind: 'gap' | 'contradiction';
  witness: string;
  whyItMatters: string;
  propositionA?: string;
  propositionB?: string;
}

/** Source lines a probe DECLARES it will run. A falsifiable claim, checked vs coverage. */
export interface ReachTarget {
  file: string;
  lines: number[];
}

export interface Probe {
  claimId: string;
  probe: string;
  reaches: ReachTarget[];
}

export type RunOutcome =
  | { kind: 'passed' }
  | { kind: 'assertion-failed'; message: string }
  | { kind: 'errored'; message: string };

/**
 * Per file, two sets: the lines that are statements at all (coverable), and the subset
 * that executed. The statement set is what lets reach ignore braces and blank lines a
 * model may have named — v8 never reports those as executed, so counting them would
 * falsely reject honest probes.
 */
export interface FileCoverage {
  executed: Set<number>;
  statements: Set<number>;
}
export type CoverageMap = Map<string, FileCoverage>;

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

/**
 * vitest's v8 provider writes coverage-final.json in istanbul shape:
 *   { "<abs>": { path, statementMap: { "0": {start:{line},end:{line}} }, s: { "0": hits } } }
 * A line executed if any statement covering it has non-zero hits. Paths are absolute;
 * rebased onto hiveRoot so a target reads 'packages/core/src/lib/event-store.ts'.
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
    const fc = map.get(file) ?? { executed: new Set<number>(), statements: new Set<number>() };
    for (const [id, stmt] of Object.entries(entry.statementMap)) {
      const hit = entry.s[id] > 0;
      for (let l = stmt.start.line; l <= stmt.end.line; l++) {
        fc.statements.add(l); // every line a statement covers is coverable...
        if (hit) fc.executed.add(l); // ...and executed iff that statement ran
      }
    }
    map.set(file, fc);
  }
  return map;
}

/**
 * SATISFIED if the probe executed EVERY statement-line it declared. Not "at least one":
 * that rule was too weak, and a real run proved it. The C1 probe declared the buggy
 * incremental-replay path (lines 677-686) AND a dozen generic lines that run on every
 * replay. Under an in-memory test db the incremental path is dead, so 677-686 never ran
 * — but the generic lines did, and "at least one" then reported the untested claim as
 * REFUTED. The claim's own code never executed and the gate blessed it anyway.
 *
 * So the declaration is a COMMITMENT: run everything you named. A probe that names the
 * claim's code and doesn't run it has not reached the claim — that IS test-double
 * divergence, and the honest verdict is UNREACHABLE, not REFUTED.
 *
 * Non-statement declared lines (braces, blanks, bad numbers) are ignored, never counted
 * against the probe — v8 cannot report them executed, so requiring them would be the
 * false rejection the commit-msg hook warned about. Only real, coverable statement lines
 * are held to the commitment. If a probe declares no statement line at all, there is
 * nothing to verify and reach is not satisfied.
 */
export function checkReach(targets: ReachTarget[], covered: CoverageMap): ReachCheck[] {
  return targets.map(target => {
    const fc = covered.get(target.file) ?? { executed: new Set<number>(), statements: new Set<number>() };
    const checkable = target.lines.filter(l => fc.statements.has(l));
    const hit = checkable.filter(l => fc.executed.has(l));
    const missed = checkable.filter(l => !fc.executed.has(l));
    return { target, hit, missed, satisfied: checkable.length > 0 && missed.length === 0 };
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
    const where = unmet.map(r => `${r.target.file}:${r.target.lines.join(',')}`).join('; ');
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
  return { verdict: 'REFUTED', reason: 'the probe reached the code and passed — the claim does not hold' };
}
