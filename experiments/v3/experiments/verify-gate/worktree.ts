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
 * laundered into INVALID verdicts. The gate config is copied in from the experiment dir.
 */
export function ensureWorktree(opts: {
  hiveRepo: string;
  sha: string;
  root: string;
  configSrc: string;
}): string {
  const dir = join(opts.root, `hive-${opts.sha.slice(0, 7)}`);
  const stamp = join(dir, '.gate-ready');
  if (!existsSync(stamp)) {
    mkdirSync(opts.root, { recursive: true });
    if (!existsSync(dir)) sh('git', ['worktree', 'add', '--detach', dir, opts.sha], opts.hiveRepo);
    sh('pnpm', ['install'], dir);
    sh('pnpm', ['build:core'], dir);
    sh('pnpm', ['--filter', '@hive/tests', 'add', '-D', '@vitest/coverage-v8@^1.0.0'], dir);
    writeFileSync(stamp, `${opts.sha}\n`);
  }
  // Always refresh the gate config from source — it is the one thing that changes.
  writeFileSync(join(dir, 'packages/tests/vitest.gate.config.ts'), readFileSync(opts.configSrc, 'utf8'));
  return dir;
}
