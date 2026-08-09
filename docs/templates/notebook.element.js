// What the notebook is, in the terms the drawing needs.
//
// The chain ranks by a vocabulary of claims. Nothing here has one: eight
// relations join six types in whatever order the thinking went. What it does
// have is time, and every node carries the day it belongs to.
//
// Counted before deciding: 502 of 629 edges join two nodes from the same day.
// So a day is a partition rather than a rank — columns of days alone would
// leave four fifths of the edges doubling back inside a column, which is the
// fault columns exist to remove. Days are the outer axis, and a day's own nodes
// rank into sub-columns inside it.

const notebook = JSON.parse(document.getElementById('notebook').textContent)
const nodeById = new Map(notebook.nodes.map(n => [n.address, n]))

/**
 * What each node sits downstream of.
 *
 * Most relations point at what a node answers to, so the target is upstream.
 * `leads_to` is the exception and runs the other way: a goal leads to its
 * outcome, so the goal is what the outcome came out of. Reading every edge the
 * same way would put an outcome to the left of the goal that produced it.
 */
const parentsOf = {}
for (const node of notebook.nodes) parentsOf[node.address] = []
for (const edge of notebook.edges) {
  if (edge.rel === 'leads_to') parentsOf[edge.to]?.push(edge.from)
  else parentsOf[edge.from]?.push(edge.to)
}

/**
 * The day an entry first arrived, read from the commit that added it.
 *
 * A filename used to carry this. An entry accretes now, so a date on it would
 * be a second copy of something git already answers, and the first thing to go
 * stale. What the column shows is therefore when a thought turned up, not when
 * somebody last edited the page it lives on.
 */
const dayOf = (address) => (notebook.arrived[address] ?? '').slice(0, 10)
const days = [...new Set(notebook.nodes.map(n => dayOf(n.address)))].sort()

/**
 * How deep a node sits inside its own day.
 *
 * A node nothing in the day points at opens the day, and everything else sits
 * one column right of the furthest thing in the day pointing at it. Only edges
 * inside the day count: one reaching back to a goal from three weeks ago says
 * nothing about where a node belongs today.
 *
 * Walking the edges rather than the types. Ranking by type was the other
 * candidate and the counts rule it out — observations are 224 of 565, so a type
 * column would hold two fifths of the graph with its edges reaching everywhere.
 */
function depthWithinDay(address, seen = new Set()) {
  if (seen.has(address)) return 0
  seen.add(address)
  const day = dayOf(address)
  const inside = (parentsOf[address] || []).filter(p => nodeById.has(p) && dayOf(p) === day)
  if (!inside.length) return 0
  return 1 + Math.max(...inside.map(p => depthWithinDay(p, seen)))
}

const depth = {}
for (const node of notebook.nodes) depth[node.address] = depthWithinDay(node.address)

/**
 * Order among nodes a day's edges say nothing about.
 *
 * Git holds the moment a file arrived, which survives a clone because it is
 * history rather than a fact about a filesystem. Nodes added in one commit
 * share a moment, so this orders in clusters, and a commit is a unit of work.
 */
const arrived = (address) => notebook.arrived[address] ?? ''

/**
 * One column per depth within a day, and the day's name on the first of them.
 *
 * The columns after it hold the same day, and repeating the date says nothing a
 * reader cannot see from the edges arriving into them.
 */
const ranks = []
for (const day of days) {
  const inDay = notebook.nodes.filter(n => dayOf(n.address) === day)
  const deepest = Math.max(0, ...inDay.map(n => depth[n.address]))
  for (let d = 0; d <= deepest; d++) {
    const items = inDay
      .filter(n => depth[n.address] === d)
      .sort((a, b) => arrived(a.address).localeCompare(arrived(b.address)))
      .map(n => ({ address: n.address, title: n.title, kind: n.kind, group: n.kind, subsystem: '' }))
    if (items.length) ranks.push({ name: d === 0 ? day : '', items })
  }
}

const childrenOf = {}
for (const [child, parents] of Object.entries(parentsOf))
  for (const parent of parents) (childrenOf[parent] ??= []).push(child)

/**
 * Everything one way from a node, following the whole distance rather than one
 * step.
 *
 * The set of what it found is also what keeps a cycle from walking forever, and
 * this graph has them: contradicts and alternative_to join two nodes without
 * either sitting above the other.
 */
function walk(address, edges) {
  const found = new Set()
  const queue = [address]
  while (queue.length) {
    for (const next of edges[queue.pop()] || []) {
      if (found.has(next)) continue
      found.add(next)
      queue.push(next)
    }
  }
  return found
}

/**
 * How each relation reads, and which side of the node it belongs on.
 *
 * A lookup rather than a derivation. Where a neighbour sits used to fall out of
 * the ranking, which meant a reader asking why "supports" sat on the left got
 * an answer about which file stores the edge. That is a fact about the corpus
 * and not about the claim in front of them.
 *
 * So each relation states both readings and where each one goes. Left is what a
 * node rests on and right is what rests on it, and every line here is a
 * judgement somebody can disagree with by editing it.
 *
 * `alternative_to` reads the same both ways and sits on the left twice, since
 * neither of two alternatives rests on the other.
 */
const RELATIONS = {
  depends_on: { out: ['depends on', 0], in: ['depended on by', 1] },
  supports: { out: ['supports', 0], in: ['supported by', 1] },
  elaborates: { out: ['elaborates', 0], in: ['elaborated by', 1] },
  specifies: { out: ['specifies', 1], in: ['specified by', 0] },
  leads_to: { out: ['leads to', 1], in: ['came out of', 0] },
  blocks: { out: ['blocks', 1], in: ['blocked by', 0] },
  contradicts: { out: ['contradicts', 1], in: ['contradicted by', 1] },
  alternative_to: { out: ['alternative to', 0], in: ['alternative to', 0] },
}

/**
 * A node's neighbours, grouped by the relation joining them.
 *
 * Outgoing groups come first within a column, since a node's own edges are what
 * it says and the incoming ones are what everything else said about it.
 */
function sidesFor(address) {
  const groups = new Map()
  const add = ([title, column], rel, target) => {
    if (!groups.has(title)) groups.set(title, { rel, column, addresses: [] })
    groups.get(title).addresses.push(target)
  }
  for (const edge of notebook.edges) {
    const reading = RELATIONS[edge.rel] ?? { out: [edge.rel, 0], in: [edge.rel, 1] }
    if (edge.from === address) add(reading.out, edge.rel, edge.to)
    if (edge.to === address) add(reading.in, edge.rel, edge.from)
  }
  return [...groups].map(([title, side]) => ({ title, ...side }))
}

const nodeAt = (address) => nodeById.get(address)
const litFrom = (address) => new Set([address, ...walk(address, parentsOf), ...walk(address, childrenOf)])

// Drawn as the corpus stores them, so an arrowhead lands where somebody wrote
// it. Ranking reverses leads_to and drawing must not: a goal leads to its
// outcome, and the arrow saying so is the whole content of that edge.
const drawnEdges = notebook.edges
  .filter(e => nodeById.has(e.from) && nodeById.has(e.to))
  .map(e => ({ from: e.from, to: e.to, rel: e.rel }))

mountGraph({ ranks, parentsOf, edges: drawnEdges, bands: [], nodeAt, litFrom, sidesFor })
