// What a canon chain is, in the terms the drawing needs: which ranks exist,
// which edges join what, which bands hold a stripe, and how to describe one
// address.
//
// Everything after that — the columns, the wires, the pane, the measuring —
// belongs to graph.element.js, which knows none of this.
//
// @ts-check
"use strict"
{

/**
 * @typedef {object} ChainAxiom
 * @property {string} address
 * @property {string} title
 * @property {string} detail
 * @property {string} canon
 * @property {string[]} narrows
 * @property {number} depth
 * @property {number} behaviours
 */

/**
 * @typedef {object} ChainSpecification
 * @property {string} address
 * @property {string} title
 * @property {string} detail
 * @property {string} canon
 * @property {string[]} specifies
 */

/**
 * @typedef {object} ChainBehaviour
 * @property {string} address
 * @property {string} title
 * @property {string} detail
 * @property {string} kind
 * @property {string} specification
 * @property {string[]} refines
 * @property {string | null} parent
 * @property {string} check
 * @property {string} fixture
 */

/**
 * @typedef {object} ChainCode
 * @property {string} address
 * @property {string} file
 * @property {string} name
 * @property {string} kind
 * @property {string} doc
 * @property {string} snippet
 * @property {string[]} cites
 */

/**
 * @typedef {object} ChainData
 * @property {ChainAxiom[]} axioms
 * @property {ChainSpecification[]} specifications
 * @property {ChainBehaviour[]} behaviours
 * @property {ChainCode[]} code
 * @property {Record<string, string[]>} reach
 * @property {Record<string, string[]>} above
 */

const data = /** @type {ChainData} */ (JSON.parse(/** @type {string} */ (document.getElementById('chain')?.textContent)))

/**
 * Which subsystem an address belongs to, read off the canon document holding
 * it.
 *
 * Every rank groups already, and each names its groups differently: a canon in
 * the axiom column, a specification's title in the behaviour column, a filename
 * in the implementation column. Nothing could tell that figure, the figure
 * layout engine and templates/figure.element.js are one subsystem, so the bands
 * never lined up and the edges between them crossed everything in the way.
 *
 * @param {string} address
 * @returns {string}
 */
function subsystemOf(address) {
  const file = address.split('#')[0]
  return file.endsWith('.canon.html') ? (file.split('/').pop() ?? '').replace('.canon.html', '') : ''
}

/**
 * Which subsystem answers for a file, from the specification naming it.
 *
 * A declaration sits in a source file and belongs to the subsystem that took
 * responsibility for it.
 */
/** @type {Record<string, string>} */
const subsystemOfFile = {}
for (const specification of data.specifications)
  for (const file of specification.specifies) subsystemOfFile[file] = subsystemOf(specification.address)

/**
 * Ranks, left to right.
 *
 * An axiom sits in the column its narrowing depth puts it in, so an axiom
 * narrowing another lands right of it and that edge crosses a column like every
 * other edge rather than doubling back inside one.
 */
const axiomDepth = Math.max(0, ...data.axioms.map(axiom => axiom.depth))
/** @type {Rank[]} */
const ranks = []
for (let depth = 0; depth <= axiomDepth; depth++)
  // Only the first axiom column carries the heading. The ones after it hold
  // axioms too, narrower ones, and naming that again says nothing a reader
  // cannot see from the edges arriving into them.
  ranks.push({ name: depth === 0 ? 'axioms' : '', items: data.axioms.filter(axiom => axiom.depth === depth)
    .map(axiom => ({ address: axiom.address, title: axiom.title, group: axiom.canon, kind: 'axiom',
                 subsystem: subsystemOf(axiom.address),
                 reach: axiom.behaviours, counts: 'behaviours beneath this, at any depth' })) })

const specificationTitle = Object.fromEntries(data.specifications.map(specification => [specification.address, specification.title]))
const behaviourAt = new Map(data.behaviours.map(behaviour => [behaviour.address, behaviour]))

/**
 * How many claims a claim sits inside.
 *
 * A behaviour narrows a behaviour by holding it, so its depth is the walk up
 * to a claim nothing holds. The axiom rank ranks by narrowing depth for the
 * same reason: a narrower thing belongs one column right of the thing it
 * narrows, and then its edge crosses a column like every other edge instead of
 * doubling back inside one.
 *
 * @param {ChainBehaviour} behaviour
 * @returns {number}
 */
function behaviourDepth(behaviour) {
  let depth = 0
  /** @type {ChainBehaviour | undefined} */
  let at = behaviour
  while (at && at.parent) { depth++; at = behaviourAt.get(at.parent) }
  return depth
}

const depths = data.behaviours.map(behaviourDepth)
const behaviourDepthMax = Math.max(0, ...depths)
for (let depth = 0; depth <= behaviourDepthMax; depth++)
  ranks.push({ name: depth === 0 ? 'behaviours' : '', items: data.behaviours
    .filter((behaviour, index) => depths[index] === depth)
    .map(behaviour => ({ address: behaviour.address, title: behaviour.title,
                 group: specificationTitle[behaviour.specification] || 'unspecified',
                 kind: behaviour.check ? 'behaviour' : 'behaviour, proved beneath',
                 subsystem: subsystemOf(behaviour.specification), groupOf: behaviour.specification })) })

/**
 * One box per cited declaration, grouped by the file holding it. A file
 * nothing cites still appears, carrying no declarations, because a subsystem
 * naming a file with no claims in it is worth seeing rather than hiding.
 *
 * @behaviour canon/chain.canon.html#the-rank-shows-a-cited-declaration
 * @param {string} file
 * @returns {string}
 */
const shortFile = (file) => file.replace(/^docs\//, '')

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
 * @param {ChainCode} code
 * @returns {number | undefined}
 */
const claimsOf = (code) => code.cites.length > 1 ? code.cites.length : undefined

/** @type {Item[]} */
const declarations = data.code.map(code =>
  ({ address: code.address, title: code.name, group: shortFile(code.file), reach: claimsOf(code),
     kind: code.kind || 'declaration', counts: 'claims this one declaration answers',
     subsystem: subsystemOfFile[code.file] ?? '' }))
const cited = new Set(data.code.map(code => code.file))
for (const specification of data.specifications)
  for (const file of specification.specifies)
    if (!cited.has(file)) declarations.push({ address: file, title: shortFile(file), group: shortFile(file),
                                           subsystem: subsystemOfFile[file] ?? '', file: true })
ranks.push({ name: 'implementation', items: declarations })

/** What each item points at, which is the direction the corpus stores. */
/** @type {Record<string, string[]>} */
const parentsOf = {}
for (const axiom of data.axioms) parentsOf[axiom.address] = axiom.narrows
for (const behaviour of data.behaviours) parentsOf[behaviour.address] = behaviour.refines
for (const specification of data.specifications)
  for (const file of specification.specifies) parentsOf[file] = [specification.address]
for (const code of data.code) parentsOf[code.address] = code.cites

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
const bands = [...new Set(data.axioms.map(axiom => subsystemOf(axiom.address)).filter(subsystem => subsystem && subsystem !== 'root'))]
for (const specification of data.specifications) {
  const name = subsystemOf(specification.address)
  if (name && !bands.includes(name)) bands.push(name)
}
bands.splice(Math.floor(bands.length / 2), 0, 'root')

/**
 * Everything the corpus knows about one address, whichever rank it sits in.
 *
 * The page holds each rank as its own list, so this asks all of them rather
 * than keeping a fifth index that could disagree with the four.
 *
 * @param {string} address
 * @returns {GraphNode | undefined}
 */
function nodeAt(address) {
  return data.axioms.find(axiom => axiom.address === address)
    || data.behaviours.find(behaviour => behaviour.address === address)
    || data.specifications.find(specification => specification.address === address)
    || data.code.find(code => code.address === address)
}

/**
 * Selecting anything lights the whole chain it belongs to, above and below.
 *
 * A specification has no chain of its own, so it stands for its behaviours.
 *
 * @param {string} address
 * @returns {Set<string>}
 */
function litFrom(address) {
  const specification = data.specifications.find(specification => specification.address === address)
  if (!specification) return new Set([address, ...(data.reach[address] || []), ...(data.above[address] || [])])
  const lit = new Set([address, ...specification.specifies])
  for (const behaviour of data.behaviours.filter(behaviour => behaviour.specification === address))
    for (const reached of [behaviour.address, ...(data.reach[behaviour.address] || []), ...(data.above[behaviour.address] || [])]) lit.add(reached)
  return lit
}

/**
 * How far a claim reaches downward, counting only behaviours, which is what the
 * badge on an axiom shows.
 *
 * Silent when it agrees with the one step the pane lists beneath it, since a
 * line repeating the list under it earns nothing.
 *
 * @param {string} address
 * @returns {string}
 */
function impactFor(address) {
  const reached = (data.reach[address] || []).filter(candidate => behaviourAt.has(candidate)).length
  const steps = Object.entries(parentsOf).filter(([, parents]) => (parents || []).includes(address)).length
  return reached > steps ? `impacts ${reached} behaviours` : ''
}

/**
 * The edges as drawn, each carrying what kind of step it is.
 *
 * A claim narrows an axiom, a claim holds a narrower claim, a specification
 * names a file, and a declaration answers a claim. All four run upward and
 * nothing distinguished them on the page.
 *
 * @param {string} from
 * @returns {string}
 */
const kindOfEdge = (from) =>
  data.code.some(code => code.address === from) ? 'answers'
  : data.behaviours.some(behaviour => behaviour.address === from) ? 'narrows'
  : 'specifies'

/** @type {DrawnEdge[]} */
const drawnEdges = Object.entries(parentsOf)
  .flatMap(([child, parents]) => parents.map(parent => ({ from: child, to: parent, rel: kindOfEdge(child) })))

mountGraph({ ranks, parentsOf, edges: drawnEdges, bands, nodeAt, litFrom, impactFor })

}
