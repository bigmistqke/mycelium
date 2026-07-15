// Mid-run introspection. Recomputes each claim's verdict from artifacts already on
// disk — the cached probe, the vitest result, the coverage — WITHOUT running anything.
// Use it to watch a `node run.ts` still in flight, or to re-derive verdicts after a
// change to the verdict logic without paying for probe generation again.
//
//   node peek.ts
//
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classify } from './run-probe.ts';
import { parseCoverage, checkReach, decide } from './verdict.ts';
import { HIVE_SHA } from './worktree.ts';
import type { Probe, Verdict } from './verdict.ts';

const HERE = new URL('.', import.meta.url).pathname;
const CACHE = join(HERE, 'probes');
const WORKTREE = new URL(`../../../../.mycelium/worktrees/hive-${HIVE_SHA.slice(0, 7)}`, import.meta.url).pathname;
const TOTAL = 22;

const order: Verdict[] = ['CONFIRMED', 'UNREACHABLE', 'REFUTED', 'INVALID'];
const tally = { CONFIRMED: 0, REFUTED: 0, UNREACHABLE: 0, INVALID: 0 } as Record<Verdict, number>;
const bucket: Record<string, string[]> = { CONFIRMED: [], UNREACHABLE: [], REFUTED: [], INVALID: [], pending: [] };

const ids = existsSync(CACHE)
  ? readdirSync(CACHE).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
  : [];

for (const id of ids) {
  const probe = JSON.parse(readFileSync(join(CACHE, `${id}.json`), 'utf8')) as Probe;
  const resultPath = join(WORKTREE, '.gate', id, 'result.json');
  if (!existsSync(resultPath)) {
    bucket.pending.push(id); // probe generated, not yet run
    continue;
  }
  const outcome = classify(JSON.parse(readFileSync(resultPath, 'utf8')), '');
  const covPath = join(WORKTREE, '.gate', id, 'coverage', 'coverage-final.json');
  const covered = existsSync(covPath) ? parseCoverage(covPath, WORKTREE) : new Map();
  const { verdict } = decide(outcome, checkReach(probe.reaches, covered));
  tally[verdict]++;
  bucket[verdict].push(id);
}

console.log('');
const sortIds = (a: string[]) => a.sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
for (const v of order) {
  if (!bucket[v].length) continue;
  console.log(`  ${v.padEnd(12)} ${sortIds(bucket[v]).join(' ')}`);
}
if (bucket.pending.length) console.log(`  ${'pending'.padEnd(12)} ${sortIds(bucket.pending).join(' ')}`);
console.log('  ' + '─'.repeat(45));
console.log(
  `  ${tally.CONFIRMED} confirmed · ${tally.UNREACHABLE} unreachable · ${tally.REFUTED} refuted · ${tally.INVALID} invalid` +
    `   (${ids.length}/${TOTAL} probed)\n`,
);
