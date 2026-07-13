/**
 * Completeness check over a proposition set.
 *
 * Propositions are (guard, answer) pairs — regions of the input space, not points.
 * Two questions you can ask of regions but never of examples:
 *   GAP          — an input satisfying NO guard  → behaviour never specified
 *   CONTRADICTION— an input satisfying TWO guards that disagree → specified twice, incompatibly
 *
 * Brute-forced over a small domain here for clarity; an SMT solver does this
 * over all of i32 without enumerating.
 */

type Input = { value: number; min: number; max: number }

interface Proposition {
  id: string
  text: string
  guard: (i: Input) => boolean
  answer: (i: Input) => number
}

// The propositions an LLM would naturally write for clamp — WITHOUT knowing
// about the min > max case. This is the honest starting point.
const PROPS: Proposition[] = [
  {
    id: 'P1',
    text: 'value below min → returns min',
    guard: i => i.value < i.min,
    answer: i => i.min,
  },
  {
    id: 'P2',
    text: 'value above max → returns max',
    guard: i => i.value > i.max,
    answer: i => i.max,
  },
  {
    id: 'P3',
    text: 'value within range → returns value',
    guard: i => i.value >= i.min && i.value <= i.max,
    answer: i => i.value,
  },
]

const R = [-2, -1, 0, 1, 2]
const gaps: Input[] = []
const contradictions: { input: Input; a: Proposition; b: Proposition; ansA: number; ansB: number }[] = []

for (const value of R)
  for (const min of R)
    for (const max of R) {
      const input = { value, min, max }
      const hit = PROPS.filter(p => p.guard(input))

      if (hit.length === 0) gaps.push(input)

      for (let i = 0; i < hit.length; i++)
        for (let j = i + 1; j < hit.length; j++) {
          const ansA = hit[i].answer(input)
          const ansB = hit[j].answer(input)
          if (ansA !== ansB)
            contradictions.push({ input, a: hit[i], b: hit[j], ansA, ansB })
        }
    }

const fmt = (i: Input) => `clamp(value=${i.value}, min=${i.min}, max=${i.max})`

console.log(`\nchecked ${R.length ** 3} inputs against ${PROPS.length} propositions\n`)

console.log(`GAPS (no proposition says what to do): ${gaps.length}`)
for (const g of gaps.slice(0, 3)) console.log(`    ${fmt(g)}`)

console.log(`\nCONTRADICTIONS (two propositions disagree): ${contradictions.length}`)
for (const c of contradictions.slice(0, 4))
  console.log(
    `    ${fmt(c.input)}\n` +
      `        ${c.a.id} "${c.a.text}" → ${c.ansA}\n` +
      `        ${c.b.id} "${c.b.text}" → ${c.ansB}`,
  )

if (contradictions.length) {
  const witnesses = new Set(contradictions.map(c => `${c.input.min} > ${c.input.max}`))
  console.log(
    `\n  every contradiction shares one shape: min > max  (${witnesses.size} distinct witnesses)`,
  )
  console.log(`  → the spec is inconsistent on the empty range. Nobody had to already know that.`)
}
