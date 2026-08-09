const data = JSON.parse(document.getElementById('chain').textContent)
const grid = document.getElementById('grid')
const wires = document.getElementById('wires')

// Ranks, left to right. An axiom sits in the column its narrowing depth puts
// it in, so an axiom narrowing another lands right of it and that edge crosses
// a column like every other edge rather than doubling back inside one.
const axiomDepth = Math.max(0, ...data.axioms.map(a => a.depth))
const ranks = []
for (let d = 0; d <= axiomDepth; d++)
  // Only the first axiom column carries the heading. The ones after it hold
  // axioms too, narrower ones, and naming that again says nothing a reader
  // cannot see from the edges arriving into them.
  ranks.push({ name: d === 0 ? 'axioms' : '', items: data.axioms.filter(a => a.depth === d)
    .map(a => ({ address: a.address, title: a.title, group: a.canon, reach: a.behaviours })) })

const specTitle = Object.fromEntries(data.specifications.map(s => [s.address, s.title]))
ranks.push({ name: 'behaviours', items: data.behaviours.map(b =>
  ({ address: b.address, title: b.title, group: specTitle[b.specification] || 'unspecified', groupOf: b.specification })) })
/**
 * One box per cited declaration, grouped by the file holding it. A file
 * nothing cites still appears, carrying no declarations, because a subsystem
 * naming a file with no claims in it is worth seeing rather than hiding.
 *
 * @behaviour canon/chain.canon.html#the-rank-shows-a-cited-declaration
 */
const shortFile = (f) => f.replace(/^docs\//, '')
const declarations = data.code.map(d =>
  ({ address: d.address, title: d.name, group: shortFile(d.file), code: d }))
const cited = new Set(data.code.map(d => d.file))
for (const s of data.specifications)
  for (const f of s.specifies)
    if (!cited.has(f)) declarations.push({ address: f, title: shortFile(f), group: shortFile(f), file: true })
ranks.push({ name: 'implementation', items: declarations })

// What each item points at, for ordering a column against the one before it.
const parentsOf = {}
for (const a of data.axioms) parentsOf[a.address] = a.narrows
for (const b of data.behaviours) parentsOf[b.address] = b.refines
for (const s of data.specifications) for (const f of s.specifies) parentsOf[f] = [s.address]
for (const d of data.code) parentsOf[d.address] = d.cites

// Fewer crossings, by putting each item near whatever it points at. A group
// takes the mean position of its members, and members sort inside it, so the
// subsystem stays readable while the lines stop fighting each other.
const row = {}
for (const rank of ranks) {
  const mean = (item) => {
    const ps = (parentsOf[item.address] || []).map(p => row[p]).filter(n => n !== undefined)
    return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Number.MAX_SAFE_INTEGER
  }
  const groups = new Map()
  for (const item of rank.items) {
    if (!groups.has(item.group)) groups.set(item.group, [])
    groups.get(item.group).push(item)
  }
  for (const items of groups.values()) items.sort((a, b) => mean(a) - mean(b))
  rank.groups = [...groups.entries()]
    .map(([name, items]) => ({ name, items, groupOf: items[0].groupOf,
      at: items.reduce((n, i) => n + (mean(i) === Number.MAX_SAFE_INTEGER ? 0 : mean(i)), 0) / items.length }))
    .sort((a, b) => (a.name === 'root' ? -1 : b.name === 'root' ? 1 : a.at - b.at))
  let n = 0
  for (const group of rank.groups) for (const item of group.items) row[item.address] = n++
}

/**
 * A cited declaration's doc comment and the first lines beneath it, in a
 * collapsible closed by default.
 *
 * A reader following a claim down to the code came for the code. The comment
 * carrying the citation is the part worth showing, since it holds the
 * reasoning and addresses a person rather than a compiler, so it opens first
 * with the lines it introduces under it.
 *
 * @behaviour canon/chain.canon.html#the-drawing-carries-the-comment-and-the-code
 */
function codeFor(code) {
  const d = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = code.kind || 'declaration'
  d.appendChild(summary)
  if (code.doc) {
    const doc = document.createElement('p')
    doc.className = 'doc'
    doc.textContent = code.doc
    d.appendChild(doc)
  }
  const pre = document.createElement('pre')
  pre.textContent = code.snippet
  d.appendChild(pre)
  return d
}

for (const rank of ranks) {
  const column = document.createElement('div')
  column.className = 'rank'
  column.innerHTML = rank.name ? '<h2>' + rank.name + '</h2>' : '<h2>&nbsp;</h2>'
  for (const group of rank.groups) {
    const g = document.createElement('div')
    g.className = 'group'
    const h = document.createElement('h3')
    h.textContent = group.name
    // A specification is selectable too, so a whole subsystem lights at once.
    if (group.groupOf) { h.dataset.address = group.groupOf; h.className = 'selectable' }
    g.appendChild(h)
    for (const item of group.items) {
      const el = document.createElement('div')
      el.className = 'node' + (item.file ? ' file' : '')
      el.dataset.address = item.address
      el.innerHTML = (item.reach === undefined ? '' : '<span class="reach">' + item.reach + '</span>')
        + '<span class="title"></span>'
      el.querySelector('.title').textContent = item.title
      g.appendChild(el)
    }
    column.appendChild(g)
  }
  grid.appendChild(column)
}
grid.style.gridTemplateColumns = 'repeat(' + ranks.length + ', minmax(160px, 1fr))'

const links = []
for (const [child, parents] of Object.entries(parentsOf))
  for (const parent of parents) links.push([child, parent])

const boxOf = (address) => grid.querySelector('[data-address="' + CSS.escape(address) + '"]')

/**
 * Where a box sits on the canvas the wires run across.
 *
 * The browser measures a box against the viewport, and the canvas covers the
 * grid's whole content rather than the part of it on screen. So the grid's own
 * visible corner comes off, and whatever it has scrolled goes back on. Leaving
 * the scroll out draws every wire at the offset the reader last scrolled by,
 * which looks like a layout fault and is a stale measurement.
 */
function pointIn(rect) {
  const origin = grid.getBoundingClientRect()
  return {
    left: rect.left - origin.left + grid.scrollLeft,
    right: rect.right - origin.left + grid.scrollLeft,
    middle: rect.top - origin.top + grid.scrollTop + rect.height / 2,
  }
}

function draw() {
  wires.setAttribute('viewBox', '0 0 ' + grid.scrollWidth + ' ' + grid.scrollHeight)
  wires.style.width = grid.scrollWidth + 'px'
  wires.style.height = grid.scrollHeight + 'px'
  wires.innerHTML = ''
  for (const [from, to] of links) {
    const a = boxOf(from), b = boxOf(to)
    if (!a || !b) continue
    const ra = pointIn(a.getBoundingClientRect()), rb = pointIn(b.getBoundingClientRect())
    const x1 = ra.left, y1 = ra.middle
    const x2 = rb.right, y2 = rb.middle
    const mid = (x1 + x2) / 2
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2)
    path.dataset.from = from
    path.dataset.to = to
    wires.appendChild(path)
  }
}

// Selecting anything lights the whole chain it belongs to, above and below.
// A specification has no chain of its own, so it stands for its behaviours.
function chainOf(address) {
  const spec = data.specifications.find(s => s.address === address)
  if (!spec) return new Set([address, ...(data.reach[address] || []), ...(data.above[address] || [])])
  const lit = new Set([address, ...spec.specifies])
  for (const b of data.behaviours.filter(b => b.specification === address))
    for (const a of [b.address, ...(data.reach[b.address] || []), ...(data.above[b.address] || [])]) lit.add(a)
  return lit
}

const pane = document.getElementById('pane')

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
 * Fill the pane from one node, or hide it when nothing is selected.
 *
 * One shape for every rank, so the gesture stays uniform and a reader never
 * learns which boxes reward a click. A claim shows the reasoning it carries and
 * a declaration shows the comment that named the claim with the lines beneath
 * it, and a claim carrying neither shows what it is and where it lives.
 *
 * @behaviour canon/chain.canon.html#the-drawing-carries-the-comment-and-the-code
 */
function fillPane(address) {
  const node = address && nodeAt(address)
  if (!node) { pane.hidden = true; return }
  const file = node.address.split('#')[0].replace(/^docs\//, '')
  document.getElementById('pane-title').textContent = node.title || node.name
  document.getElementById('pane-where').textContent = (node.kind || node.code_kind || 'declaration') + ' in ' + file
  const detail = document.getElementById('pane-detail')
  detail.textContent = ''
  if (node.detail) detail.innerHTML = node.detail
  if (node.doc !== undefined || node.snippet !== undefined) detail.appendChild(codeFor(node))
  const anchor = document.getElementById('pane-anchor')
  anchor.href = node.address.replace(/^docs\//, '')
  anchor.textContent = 'open ' + file
  pane.hidden = false
}

let selected = null
function select(address) {
  selected = address === selected ? null : address
  const lit = selected ? chainOf(selected) : null
  for (const el of grid.querySelectorAll('[data-address]')) {
    el.classList.toggle('lit', !!lit && lit.has(el.dataset.address))
    el.classList.toggle('dim', !!lit && !lit.has(el.dataset.address))
  }
  for (const path of wires.querySelectorAll('path'))
    path.classList.toggle('lit', !!lit && lit.has(path.dataset.from) && lit.has(path.dataset.to))
  fillPane(selected)
  // The pane takes height from the grid, so every box has just moved and the
  // wires still point where they were. Opening and closing join loading and
  // resizing as the moments that redraw.
  draw()
}

grid.addEventListener('click', (event) => {
  const box = event.target.closest('[data-address]')
  select(box && box.dataset.address)
})
document.getElementById('pane-close').addEventListener('click', () => select(selected))

draw()
addEventListener('resize', draw)
