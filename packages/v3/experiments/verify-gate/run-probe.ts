import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseCoverage } from './verdict.ts';
import type { CoverageMap, RunOutcome } from './verdict.ts';

const exec = promisify(execFile);

export interface VitestJson {
  testResults?: Array<{
    assertionResults?: Array<{ status: string; failureMessages?: string[] }>;
    message?: string;
  }>;
}

/**
 * An expect() failure means the claim survived falsification. A THROW — a bootstrap
 * error, a bad import — means the probe is broken and says nothing about the claim.
 * This is what stops "my setup threw" being reported as "I found a bug".
 *
 * vitest's JSON reporter (jest-compatible) reports both as status:'failed' with a
 * failureMessage, so the discriminator is the message shape, verified against real
 * output: it STRIPS an expect() failure to a chai description ("expected '95' not to
 * be '95' // Object.is equality") with no error-class token, while a thrown runtime
 * error keeps its class prefix ("TypeError: ..."). So a failure whose message opens
 * with an `XxxError:` class — other than chai's own AssertionError — is a throw.
 */
export function classify(json: VitestJson, stderr: string): RunOutcome {
  const results = json.testResults ?? [];
  const assertions = results.flatMap(r => r.assertionResults ?? []);
  if (assertions.length === 0) {
    // No `it` ran at all: an import failure, a syntax error, a crash before any test.
    const msg = results.map(r => r.message).filter(Boolean).join('\n') || stderr;
    return { kind: 'errored', message: (msg || 'no test results').slice(0, 2000) };
  }
  const failed = assertions.filter(a => a.status === 'failed');
  if (failed.length === 0) return { kind: 'passed' };

  const messages = failed.flatMap(a => a.failureMessages ?? []).join('\n');
  const first = messages.trimStart();
  const looksThrown = /^[A-Za-z]*Error[:\s]/.test(first) && !/^AssertionError\b/.test(first);
  return looksThrown
    ? { kind: 'errored', message: messages.slice(0, 2000) }
    : { kind: 'assertion-failed', message: messages.slice(0, 2000) };
}

/**
 * Run ONE probe, alone, in the pinned worktree. Alone so coverage is attributable and a
 * crash can't take the others down. hive's own 162 tests are never run.
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
      ['exec', 'vitest', 'run', '--config', 'vitest.gate.config.ts', '--reporter=json', `--outputFile=${resultPath}`],
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
      /* leave empty; classify() calls it errored */
    }
  }
  const outcome = classify(json, stderr || stdout);
  const covFile = join(covDir, 'coverage-final.json');
  const covered = existsSync(covFile) ? parseCoverage(covFile, opts.worktree) : (new Map() as CoverageMap);
  return { outcome, covered };
}
