// What a knowledge graph is, in the terms the drawing needs.
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

const knowledge = JSON.parse(document.getElementById('knowledge').textContent)
const nodeById = new Map(knowledge.nodes.map(n => [n.address, n]))

/**
 * What each node sits downstream of.
 *
 * Most relations point at what a node answers to, so the target is upstream.
 * `leads_to` is the exception and runs the other way: a goal leads to its
 * outcome, so the goal is what the outcome came out of. Reading every edge the
 * same way would put an outcome to the left of the goal that produced it.
 */
const parentsOf = {}
for (const node of knowledge.nodes) parentsOf[node.address] = []
for (const edge of knowledge.edges) {
  if (edge.rel === 'leads_to') parentsOf[edge.to]?.push(edge.from)
  else parentsOf[edge.from]?.push(edge.to)
}

const dayOf = (address) => address.split('/').pop().slice(0, 10)
const days = [...new Set(knowledge.nodes.map(n => dayOf(n.address)))].sort()

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
for (const node of knowledge.nodes) depth[node.address] = depthWithinDay(node.address)

/**
 * Order among nodes a day's edges say nothing about.
 *
 * Git holds the moment a file arrived, which survives a clone because it is
 * history rather than a fact about a filesystem. Nodes added in one commit
 * share a moment, so this orders in clusters, and a commit is a unit of work.
 */
const arrived = (address) => knowledge.arrived[address] ?? ''

/**
 * One column per depth within a day, and the day's name on the first of them.
 *
 * The columns after it hold the same day, and repeating the date says nothing a
 * reader cannot see from the edges arriving into them.
 */
const ranks = []
for (const day of days) {
  const inDay = knowledge.nodes.filter(n => dayOf(n.address) === day)
  const deepest = Math.max(0, ...inDay.map(n => depth[n.address]))
  for (let d = 0; d <= deepest; d++) {
    const items = inDay
      .filter(n => depth[n.address] === d)
      .sort((a, b) => arrived(a.address).localeCompare(arrived(b.address)))
      .map(n => ({ address: n.address, title: n.title, group: n.type, subsystem: '' }))
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

const nodeAt = (address) => nodeById.get(address)
const litFrom = (address) => new Set([address, ...walk(address, parentsOf), ...walk(address, childrenOf)])
const impactOf = (address) => walk(address, childrenOf).size

mountGraph({ ranks, parentsOf, bands: [], nodeAt, litFrom, impactOf })
