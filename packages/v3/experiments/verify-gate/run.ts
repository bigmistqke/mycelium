import { loadClaims, loadPropositions } from './claims.ts';
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
    probe = await generateProbe(claim, { cacheDir: CACHE, propositions, worktree: HIVE });
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
  // Infrastructure failure aborts. It is never laundered into INVALID verdicts.
  const worktree = ensureWorktree({ hiveRepo: HIVE, sha: HIVE_SHA, root: ROOT, configSrc: CONFIG });
  const claims = loadClaims(CORPUS);
  const propositions = loadPropositions(CORPUS);
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
