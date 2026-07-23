import { readFileSync } from 'node:fs'
import { dataflowToWat } from '/Users/bigmistqke/Documents/GitHub/mycelium/packages/v2/src/dataflow-to-wat.ts'
import wabtInit from '/Users/bigmistqke/Documents/GitHub/mycelium/node_modules/.pnpm/wabt@1.0.39/node_modules/wabt/index.js'

const ex = JSON.parse(
  readFileSync(
    '/Users/bigmistqke/Documents/GitHub/mycelium/packages/v2/examples/00_max.json',
    'utf8',
  ),
)
const fn = ex.nodes.find((n: any) => n.id === 'func-max')
const flow = ex.nodes.find((n: any) => n.id === 'flow-max')
const tests = fn.tests as { in: Record<string, number>; out: number }[]

const func = {
  name: 'max',
  params: [
    { name: 'a', type: 'i32' },
    { name: 'b', type: 'i32' },
  ],
  results: ['i32'],
}

// Mutants: plausible wrong implementations of `max`
const mutants: Record<string, (f: any) => any> = {
  ORIGINAL: f => f,
  'gt_s→gt_u (unsigned compare)': f => ({
    ...f,
    nodes: f.nodes.map((n: any) => (n.id === 'cmp' ? { ...n, op: 'i32.gt_u' } : n)),
  }),
  'gt_s→ge_s (non-strict)': f => ({
    ...f,
    nodes: f.nodes.map((n: any) => (n.id === 'cmp' ? { ...n, op: 'i32.ge_s' } : n)),
  }),
  'gt_s→lt_s (reversed)': f => ({
    ...f,
    nodes: f.nodes.map((n: any) => (n.id === 'cmp' ? { ...n, op: 'i32.lt_s' } : n)),
  }),
  'always return a': f => ({
    ...f,
    edges: f.edges.map((e: any) =>
      e.to === 'sel' && e.port === 'false' ? { ...e, from: 'a' } : e,
    ),
  }),
  'always return b': f => ({
    ...f,
    edges: f.edges.map((e: any) =>
      e.to === 'sel' && e.port === 'true' ? { ...e, from: 'b' } : e,
    ),
  }),
  'swap true/false branches': f => ({
    ...f,
    edges: f.edges.map((e: any) =>
      e.to === 'sel' && e.port === 'true'
        ? { ...e, port: 'false' }
        : e.to === 'sel' && e.port === 'false'
          ? { ...e, port: 'true' }
          : e,
    ),
  }),
}

let wabt: any

async function run(flowGraph: any) {
  const wat = dataflowToWat(flowGraph, func)
  const mod = wabt.parseWat('m.wat', `(module ${wat} (export "max" (func $max)))`)
  const { buffer } = mod.toBinary({})
  const { instance } = await WebAssembly.instantiate(buffer)
  return instance.exports.max as (a: number, b: number) => number
}

const label = (t: any) => `{a:${String(t.in.a).padStart(2)}, b:${String(t.in.b).padStart(2)}}→${String(t.out).padStart(2)}`

const rows: { mutant: string; killedBy: boolean[] }[] = []

async function main() {
wabt = await wabtInit()

for (const [name, mutate] of Object.entries(mutants)) {
  const max = await run(mutate(flow))
  const killedBy = tests.map(t => max(t.in.a, t.in.b) !== t.out)
  rows.push({ mutant: name, killedBy })
}

// print table
const header = tests.map((t, i) => `T${i + 1}`)
console.log('\nWhich test kills which mutant?   (x = test FAILS, i.e. catches the bug)\n')
console.log('  ' + 'mutant'.padEnd(30) + header.map(h => h.padStart(4)).join(''))
console.log('  ' + '-'.repeat(30 + 4 * tests.length))
for (const r of rows) {
  console.log(
    '  ' + r.mutant.padEnd(30) + r.killedBy.map(k => (k ? 'x' : '.').padStart(4)).join(''),
  )
}

console.log('\n  legend:')
tests.forEach((t, i) => console.log(`    T${i + 1} = ${label(t)}`))

// Analysis: which tests are load-bearing?
const kills = tests.map((_, i) => rows.filter(r => r.mutant !== 'ORIGINAL' && r.killedBy[i]).map(r => r.mutant))

console.log('\n  what each test uniquely catches:')
tests.forEach((t, i) => {
  const mine = new Set(kills[i])
  const others = new Set(kills.flatMap((k, j) => (j === i ? [] : k)))
  const unique = [...mine].filter(m => !others.has(m))
  const verdict =
    mine.size === 0
      ? 'VACUOUS — kills nothing'
      : unique.length === 0
        ? 'REDUNDANT — every mutant it kills is killed by another test'
        : `LOAD-BEARING — uniquely catches: ${unique.join(', ')}`
  console.log(`    T${i + 1} ${label(t)}  ${verdict}`)
})
}

main()
