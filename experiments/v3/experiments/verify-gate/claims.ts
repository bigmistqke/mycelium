import { readFileSync } from 'node:fs';
import type { Claim } from './verdict.ts';

/** The cold pass wrapped its JSON in a ```json fence, so the corpus is not valid JSON. */
function stripFences(raw: string): string {
  return raw.replace(/^\s*```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
}

interface RawGap { witness: string; why_it_matters: string; }
interface RawContra extends RawGap { proposition_a?: string; proposition_b?: string; }
interface RawProp { id: string; text: string; guard: string; answer: string; verified_by: string; }
interface RawCorpus { propositions: RawProp[]; gaps: RawGap[]; contradictions: RawContra[]; }

function parse(path: string): RawCorpus {
  return JSON.parse(stripFences(readFileSync(path, 'utf8'))) as RawCorpus;
}

/**
 * The 22 CLAIMS are the gaps + contradictions. The 29 propositions are the module's
 * contract — context for probing, never verified. Gaps/contradictions carry no id, so
 * they are numbered by index; stable because the corpus file is frozen.
 */
export function loadClaims(path: string): Claim[] {
  const c = parse(path);
  const gaps: Claim[] = c.gaps.map((g, i) => ({
    id: `G${i + 1}`, kind: 'gap', witness: g.witness, whyItMatters: g.why_it_matters,
  }));
  const contradictions: Claim[] = c.contradictions.map((x, i) => ({
    id: `C${i + 1}`, kind: 'contradiction', witness: x.witness, whyItMatters: x.why_it_matters,
    propositionA: x.proposition_a, propositionB: x.proposition_b,
  }));
  return [...gaps, ...contradictions];
}

/** The module's contract as the cold pass described it — context for a probe, not a claim. */
export function loadPropositions(path: string): string {
  return parse(path)
    .propositions.map(p => `${p.id} [${p.verified_by}] ${p.text}\n     guard: ${p.guard}\n     answer: ${p.answer}`)
    .join('\n');
}
