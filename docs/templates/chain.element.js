// What a canon chain is, in the terms the drawing needs: which ranks exist,
// which edges join what, which bands hold a stripe, and how to describe one
// address.
//
// Everything after that — the columns, the wires, the pane, the measuring —
// belongs to graph.element.js, which knows none of this.

const data = JSON.parse(document.getElementById('chain').textContent)

/**
 * Which subsystem an address belongs to, read off the canon document holding
 * it.
 *
 * Every rank groups already, and each names its groups differently: a canon in
 * the axiom column, a specification's title in the behaviour column, a filename
 * in the implementation column. Nothing could tell that figure, the figure
 * layout engine and templates/figure.element.js are one subsystem, so the bands
 * never lined up and the edges between them crossed everything in the way.
 */
function subsystemOf(address) {
  const file = address.split('#')[0]
  return file.endsWith('.canon.html') ? file.split('/').pop().replace('.canon.html', '') : ''
}

/**
 * Which subsystem answers for a file, from the specification naming it.
 *
 * A declaration sits in a source file and belongs to the subsystem that took
 * responsibility for it.
 */
const subsystemOfFile = {}
for (const s of data.specifications)
  for (const f of s.specifies) subsystemOfFile[f] = subsystemOf(s.address)

/**
 * Ranks, left to right.
 *
 * An axiom sits in the column its narrowing depth puts it in, so an axiom
 * narrowing another lands right of it and that edge crosses a column like every
 * other edge rather than doubling back inside one.
 */
const axiomDepth = Math.max(0, ...data.axioms.map(a => a.depth))
const ranks = []
for (let d = 0; d <= axiomDepth; d++)
  // Only the first axiom column carries the heading. The ones after it hold
  // axioms too, narrower ones, and naming that again says nothing a reader
  // cannot see from the edges arriving into them.
  ranks.push({ name: d === 0 ? 'axioms' : '', items: data.axioms.filter(a => a.depth === d)
    .map(a => ({ address: a.address, title: a.title, group: a.canon, kind: 'axiom',
                 subsystem: subsystemOf(a.address),
                 reach: a.behaviours, counts: 'behaviours beneath this, at any depth' })) })

const specTitle = Object.fromEntries(data.specifications.map(s => [s.address, s.title]))
const behaviourAt = new Map(data.behaviours.map(b => [b.address, b]))

/**
 * How many claims a claim sits inside.
 *
 * A behaviour narrows a behaviour by holding it, so its depth is the walk up
 * to a claim nothing holds. The axiom rank ranks by narrowing depth for the
 * same reason: a narrower thing belongs one column right of the thing it
 * narrows, and then its edge crosses a column like every other edge instead of
 * doubling back inside one.
 */
function behaviourDepth(behaviour) {
  let depth = 0
  let at = behaviour
  while (at && at.parent) { depth++; at = behaviourAt.get(at.parent) }
  return depth
}

const depths = data.behaviours.map(behaviourDepth)
const behaviourDepthMax = Math.max(0, ...depths)
for (let d = 0; d <= behaviourDepthMax; d++)
  ranks.push({ name: d === 0 ? 'behaviours' : '', items: data.behaviours
    .filter((b, i) => depths[i] === d)
    .map(b => ({ address: b.address, title: b.title, group: specTitle[b.specification] || 'unspecified',
                 kind: b.checks ? 'behaviour' : 'behaviour, proved beneath',
                 subsystem: subsystemOf(b.specification), groupOf: b.specification })) })

/**
 * One box per cited declaration, grouped by the file holding it. A file
 * nothing cites still appears, carrying no declarations, because a subsystem
 * naming a file with no claims in it is worth seeing rather than hiding.
 *
 * @behaviour canon/chain.canon.html#the-rank-shows-a-cited-declaration
 */
const shortFile = (f) => f.replace(/^docs\//, '')

/**
 * How many claims a declaration answers, shown only when it answers more than
 * one.
 *
 * One citation per declaration is the target: a function carrying five is doing
 * five things, and the count names the decomposition worth doing. Nothing
 * surfaced it, so the smell sat in the data where no reader met it.
 *
 * Silent at one, because a number every box carries is a number nobody reads
 * and the only interesting value is the one above the target.
 *
 * @behaviour canon/chain.canon.html#a-declaration-carrying-several-claims-says-how-many
 */
const claimsOf = (d) => d.cites.length > 1 ? d.cites.length : undefined

const declarations = data.code.map(d =>
  ({ address: d.address, title: d.name, group: shortFile(d.file), reach: claimsOf(d),
     kind: d.kind || 'declaration', counts: 'claims this one declaration answers',
     subsystem: subsystemOfFile[d.file] ?? '', code: d }))
const cited = new Set(data.code.map(d => d.file))
for (const s of data.specifications)
  for (const f of s.specifies)
    if (!cited.has(f)) declarations.push({ address: f, title: shortFile(f), group: shortFile(f),
                                           subsystem: subsystemOfFile[f] ?? '', file: true })
ranks.push({ name: 'implementation', items: declarations })

/** What each item points at, which is the direction the corpus stores. */
const parentsOf = {}
for (const a of data.axioms) parentsOf[a.address] = a.narrows
for (const b of data.behaviours) parentsOf[b.address] = b.refines
for (const s of data.specifications) for (const f of s.specifies) parentsOf[f] = [s.address]
for (const d of data.code) parentsOf[d.address] = d.cites

/**
 * The order subsystems keep in every rank, so one occupies the same band across
 * the page.
 *
 * Reading down the first axiom column rather than sorting by name, because the
 * axiom rank is the one whose order nothing else constrains. Every rank after
 * it then follows the order its own edges already pull it towards.
 *
 * Root goes in the middle and belongs to nothing. Its axioms serve every
 * subsystem, so the edges leaving them fan across the whole page whatever this
 * does; from the middle the furthest of them reaches half as far.
 */
const bands = [...new Set(data.axioms.map(a => subsystemOf(a.address)).filter(s => s && s !== 'root'))]
for (const s of data.specifications) {
  const name = subsystemOf(s.address)
  if (name && !bands.includes(name)) bands.push(name)
}
bands.splice(Math.floor(bands.length / 2), 0, 'root')

/**
 * Everything the corpus knows about one address, whichever rank it sits in.
 *
 * The page holds each rank as its own list, so this asks all of them rather
 * than keeping a fifth index that could disagree with the four.
 */
function nodeAt(address) {
  return data.axioms.find(a => a.address === address)
    || data.behaviours.find(b => b.address === address)
    || data.specifications.find(s => s.address === address)
    || data.code.find(d => d.address === address)
}

/**
 * Selecting anything lights the whole chain it belongs to, above and below.
 *
 * A specification has no chain of its own, so it stands for its behaviours.
 */
function litFrom(address) {
  const spec = data.specifications.find(s => s.address === address)
  if (!spec) return new Set([address, ...(data.reach[address] || []), ...(data.above[address] || [])])
  const lit = new Set([address, ...spec.specifies])
  for (const b of data.behaviours.filter(b => b.specification === address))
    for (const a of [b.address, ...(data.reach[b.address] || []), ...(data.above[b.address] || [])]) lit.add(a)
  return lit
}

/**
 * How far a claim reaches downward, counting only behaviours, which is what the
 * badge on an axiom shows.
 *
 * Silent when it agrees with the one step the pane lists beneath it, since a
 * line repeating the list under it earns nothing.
 */
function impactFor(address) {
  const reached = (data.reach[address] || []).filter(a => behaviourAt.has(a)).length
  const steps = Object.entries(parentsOf).filter(([, ps]) => (ps || []).includes(address)).length
  return reached > steps ? `impacts ${reached} behaviours` : ''
}

/**
 * The edges as drawn, each carrying what kind of step it is.
 *
 * A claim narrows an axiom, a claim holds a narrower claim, a specification
 * names a file, and a declaration answers a claim. All four run upward and
 * nothing distinguished them on the page.
 */
const kindOfEdge = (from) =>
  data.code.some(d => d.address === from) ? 'answers'
  : data.behaviours.some(b => b.address === from) ? 'narrows'
  : 'specifies'

const drawnEdges = Object.entries(parentsOf)
  .flatMap(([child, parents]) => (parents || []).map(parent => ({ from: child, to: parent, rel: kindOfEdge(child) })))

mountGraph({ ranks, parentsOf, edges: drawnEdges, bands, nodeAt, litFrom, impactFor })
