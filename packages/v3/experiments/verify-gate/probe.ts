import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Claim, Probe } from './verdict.ts';

const exec = promisify(execFile);
const TEMPLATE = new URL('./prompt.md', import.meta.url).pathname;
const EVENT_STORE_REL = 'packages/core/src/lib/event-store.ts';

/** Number every line so the model's `reaches` refer to the same lines coverage reports. */
function numberSource(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4, ' ')}  ${line}`)
    .join('\n');
}

export function buildPrompt(claim: Claim, propositions: string, numberedSource: string): string {
  return readFileSync(TEMPLATE, 'utf8')
    .replace('{{KIND}}', claim.kind)
    .replace('{{WITNESS}}', claim.witness)
    .replace('{{WHY}}', claim.whyItMatters)
    .replace('{{PROPOSITIONS}}', propositions)
    .replace('{{SOURCE}}', numberedSource);
}

/** The prompt says no fence; the model may emit one anyway. Take the first {...} object. */
export function parseProbeResponse(claimId: string, raw: string): Probe {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`probe response for ${claimId} contained no JSON object`);
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    probe: string;
    reaches: Array<{ file: string; lines: number[] }>;
  };
  if (!parsed.probe || !Array.isArray(parsed.reaches)) {
    throw new Error(`probe response for ${claimId} missing probe or reaches`);
  }
  return { claimId, probe: parsed.probe, reaches: parsed.reaches };
}

/**
 * One bounded call per claim, cached. "Write the single probe that fails if this claim is
 * true, and declare the lines it touches" has one right answer and no room to pad. The
 * module source is inlined (numbered) rather than fetched, so the call is pure text in /
 * text out — no tool permissions, and line numbers the model cites are the ones coverage
 * will report. Cached because claude -p is not deterministic and a verdict must stay
 * replayable against the probe that produced it.
 */
export async function generateProbe(
  claim: Claim,
  opts: { cacheDir: string; propositions: string; worktree: string; retries?: number },
): Promise<Probe> {
  mkdirSync(opts.cacheDir, { recursive: true });
  const cached = join(opts.cacheDir, `${claim.id}.json`);
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8')) as Probe;

  const source = numberSource(readFileSync(join(opts.worktree, EVENT_STORE_REL), 'utf8'));
  const prompt = buildPrompt(claim, opts.propositions, source);
  const attempts = (opts.retries ?? 1) + 1;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout } = await exec('claude', ['-p', prompt], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 300_000,
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
