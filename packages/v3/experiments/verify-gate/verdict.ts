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

/** file -> the set of line numbers that executed. */
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
