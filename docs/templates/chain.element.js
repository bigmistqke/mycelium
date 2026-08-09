const data = JSON.parse(document.getElementById('chain').textContent)
const grid = document.getElementById('grid')
const wires = document.getElementById('wires')

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

// Which subsystem answers for a file, from the specification naming it. A
// declaration sits in a source file and belongs to the subsystem that took
// responsibility for it.
const subsystemOfFile = {}
for (const s of data.specifications)
  for (const f of s.specifies) subsystemOfFile[f] = subsystemOf(s.address)

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
    .map(a => ({ address: a.address, title: a.title, group: a.canon,
                 subsystem: subsystemOf(a.address), reach: a.behaviours })) })

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
                 subsystem: subsystemOf(b.specification), groupOf: b.specification })) })
/**
 * One box per cited declaration, grouped by the file holding it. A file
 * nothing cites still appears, carrying no declarations, because a subsystem
 * naming a file with no claims in it is worth seeing rather than hiding.
 *
 * @behaviour canon/chain.canon.html#the-rank-shows-a-cited-declaration
 */
const shortFile = (f) => f.replace(/^docs\//, '')
const declarations = data.code.map(d =>
  ({ address: d.address, title: d.name, group: shortFile(d.file),
     subsystem: subsystemOfFile[d.file] ?? '', code: d }))
const cited = new Set(data.code.map(d => d.file))
for (const s of data.specifications)
  for (const f of s.specifies)
    if (!cited.has(f)) declarations.push({ address: f, title: shortFile(f), group: shortFile(f),
                                           subsystem: subsystemOfFile[f] ?? '', file: true })
ranks.push({ name: 'implementation', items: declarations })

// What each item points at, for ordering a column against the one before it.
const parentsOf = {}
for (const a of data.axioms) parentsOf[a.address] = a.narrows
for (const b of data.behaviours) parentsOf[b.address] = b.refines
for (const s of data.specifications) for (const f of s.specifies) parentsOf[f] = [s.address]
for (const d of data.code) parentsOf[d.address] = d.cites

// The reverse, built here and thrown away, the same as every other downward
// reach on this page. One step only: the pane lists what a claim touches
// directly, and the whole chain beneath it is what lighting the graph already
// shows.
const childrenOf = {}
for (const [child, parents] of Object.entries(parentsOf))
  for (const parent of parents) (childrenOf[parent] ??= []).push(child)

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
 * does; from the middle the furthest of them reaches half as far as it would
 * from either end.
 */
const bands = [...new Set(data.axioms.map(a => subsystemOf(a.address)).filter(s => s && s !== 'root'))]
for (const s of data.specifications) {
  const name = subsystemOf(s.address)
  if (name && !bands.includes(name)) bands.push(name)
}
bands.splice(Math.floor(bands.length / 2), 0, 'root')
const bandOf = (item) => {
  const at = bands.indexOf(item.subsystem)
  return at === -1 ? bands.length : at
}

const row = {}

/**
 * Order one rank, keeping each subsystem in its own band.
 *
 * `neighbours` decides which way the sweep looks. Ordering a rank by where its
 * parents sit pulls it towards the rank on its left; ordering it by its
 * children pulls it towards the rank on its right. Alternating the two is what
 * lets a middle rank answer to both, instead of only to whichever side the
 * first pass came from.
 *
 * The band always wins. A subsystem holds one stretch of every column whatever
 * the means say, so the sweep decides the order inside a band and never across
 * bands.
 */
function orderRank(rank, neighbours) {
  const mean = (item) => {
    const ns = (neighbours[item.address] || []).map(a => row[a]).filter(n => n !== undefined)
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : Number.MAX_SAFE_INTEGER
  }
  const groups = new Map()
  for (const item of rank.items) {
    if (!groups.has(item.group)) groups.set(item.group, [])
    groups.get(item.group).push(item)
  }
  for (const items of groups.values()) items.sort((a, b) => mean(a) - mean(b))
  rank.groups = [...groups.entries()]
    .map(([name, items]) => ({ name, items, groupOf: items[0].groupOf, band: bandOf(items[0]),
      at: items.reduce((n, i) => n + (mean(i) === Number.MAX_SAFE_INTEGER ? 0 : mean(i)), 0) / items.length }))
    .sort((a, b) => a.band - b.band || a.at - b.at)
}

// Every item's position in its own column, which is what a mean averages.
function numberRows() {
  for (const rank of ranks) {
    let n = 0
    for (const group of rank.groups) for (const item of group.items) row[item.address] = n++
  }
}

for (const rank of ranks) orderRank(rank, parentsOf)
numberRows()

/**
 * A cited declaration's whole implementation, behind a disclosure.
 *
 * Only the code sits here. The comment carrying the citation reads immediately
 * beside the claim, because that is the reasoning a reader came for, and the
 * code is what they open when the reasoning is not enough.
 *
 * Whole rather than sampled. A doc comment sits on a declaration and the parser
 * knows where that declaration ends, so nothing counts lines or guesses at a
 * closing brace.
 *
 * @behaviour canon/chain.canon.html#the-drawing-carries-the-comment-and-the-code
 */
function codeFor(code) {
  const d = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = 'implementation'
  d.appendChild(summary)
  const holder = document.createElement('div')
  holder.className = 'code'
  const pre = document.createElement('pre')
  pre.textContent = code.snippet
  holder.appendChild(pre)
  d.appendChild(holder)
  paint(holder, code.snippet)
  return d
}

/**
 * Colour a block of code once a highlighter has loaded.
 *
 * The page shows the code first and colours it afterwards, so a reader who
 * opens the pane offline still reads the code. Nothing waits on the network to
 * render.
 */
async function paint(holder, source) {
  try {
    const { codeToHtml } = await shiki()
    holder.innerHTML = await codeToHtml(source, {
      lang: 'typescript',
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
  } catch {
    // A page opened with no network keeps the plain text it already has.
  }
}

let shikiOnce = null
const shiki = () => (shikiOnce ??= import('https://esm.sh/shiki@1.24.0'))

function boxFor(item) {
  const el = document.createElement('div')
  el.className = 'node' + (item.file ? ' file' : '')
  el.dataset.address = item.address
  el.innerHTML = (item.reach === undefined ? '' : '<span class="reach">' + item.reach + '</span>')
    + '<span class="title"></span>'
  el.querySelector('.title').textContent = item.title
  return el
}

function groupBox(group) {
  const g = document.createElement('div')
  g.className = 'group'
  const h = document.createElement('h3')
  h.textContent = group.name
  // A specification is selectable too, so a whole subsystem lights at once.
  if (group.groupOf) { h.dataset.address = group.groupOf; h.className = 'selectable' }
  g.appendChild(h)
  for (const item of group.items) g.appendChild(boxFor(item))
  return g
}

/**
 * The whole grid: a column per rank, and a row per subsystem.
 *
 * A band gets the same row in every column, so a subsystem occupies one stripe
 * across the page and the edges inside it stay in that stripe. Packing each
 * column top to bottom instead put a band at the top of one column and halfway
 * down the next, which is why its edges ran diagonally over everything between
 * them.
 *
 * A band with nothing in a column leaves its cell empty. That whitespace is the
 * point: it is what holds the rest in line, and a page that fills it has gone
 * back to the arrangement this replaces.
 *
 * Called again whenever a sweep reorders anything, so what is on screen is
 * always the arrangement being measured.
 */
function render() {
  for (const cell of Array.from(grid.querySelectorAll('.rank, .cell, .headband'))) cell.remove()
  const used = bands.filter(band => ranks.some(rank => rank.groups.some(g => g.band === bands.indexOf(band))))
  const loose = ranks.some(rank => rank.groups.some(g => g.band >= bands.length))

  // A backdrop under the headings, spanning every column so the gaps between
  // them are covered too. Each heading sticks on its own, and without this the
  // boxes scroll through the space between one heading and the next.
  const backdrop = document.createElement('div')
  backdrop.className = 'headband'
  backdrop.style.gridRow = 1
  backdrop.style.gridColumn = '1 / -1'
  grid.appendChild(backdrop)

  ranks.forEach((rank, column) => {
    const head = document.createElement('div')
    head.className = 'rank'
    head.innerHTML = rank.name ? '<h2>' + rank.name + '</h2>' : '<h2>&nbsp;</h2>'
    head.style.gridColumn = column + 1
    head.style.gridRow = 1
    grid.appendChild(head)

    const rows = [...used.map(band => bands.indexOf(band)), ...(loose ? [bands.length] : [])]
    rows.forEach((band, index) => {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.style.gridColumn = column + 1
      cell.style.gridRow = index + 2
      for (const group of rank.groups.filter(g => g.band === band)) cell.appendChild(groupBox(group))
      grid.appendChild(cell)
    })
  })
}

render()
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

/**
 * How many boxes the wires currently run across.
 *
 * A wire from one column to the next has a gap to itself and crosses nothing.
 * The overlaps come from the long ones: a root axiom reaching a behaviour four
 * columns right passes over every column between, and whatever sits in those
 * columns at that height. Ordering is the only lever, since nothing here
 * reserves space the way the figure engine does.
 *
 * Measured off the drawn paths rather than recomputed, so this counts what a
 * reader sees. Sampling the curve rather than solving it: a wire crossing a box
 * spends many points inside it, and a sample fine enough to matter is cheaper
 * than the arithmetic that would be exact.
 */
function overlaps() {
  const boxes = Array.from(grid.querySelectorAll('.node')).map(el => ({
    address: el.dataset.address,
    rect: pointIn(el.getBoundingClientRect()),
    top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom,
  }))
  let count = 0
  for (const path of wires.querySelectorAll('path')) {
    const length = path.getTotalLength()
    const hit = new Set()
    for (let at = 0; at <= length; at += 6) {
      const point = path.getPointAtLength(at)
      for (const box of boxes) {
        if (box.address === path.dataset.from || box.address === path.dataset.to) continue
        if (hit.has(box.address)) continue
        const r = box.rect
        const top = r.middle - (box.bottom - box.top) / 2
        const bottom = r.middle + (box.bottom - box.top) / 2
        if (point.x >= r.left && point.x <= r.right && point.y >= top && point.y <= bottom) {
          hit.add(box.address)
          count++
        }
      }
    }
  }
  return count
}

/**
 * Pairs of boxes sitting on top of each other.
 *
 * Always zero when the placement is sound, which is why it earns a number. Rows
 * that stop growing to fit their content let one band's boxes fall through into
 * the next band's, and the only symptom is that every wire suddenly crosses far
 * more than before. Counting wires said the layout got worse; it never said the
 * boxes had landed on each other.
 */
function collisions() {
  const boxes = Array.from(grid.querySelectorAll('.node')).map(el => el.getBoundingClientRect())
  let count = 0
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) count++
    }
  return count
}

// The same count, split by how far a wire travels. Ordering and placement only
// reach the short ones; a wire spanning several columns passes over whatever
// fills those columns whatever the layout does.
function overlapsBySpan() {
  const column = {}
  Array.from(grid.querySelectorAll('.rank, .cell')).forEach(cell => {
    for (const el of cell.querySelectorAll('[data-address]')) column[el.dataset.address] = Number(cell.style.gridColumn)
  })
  const boxes = Array.from(grid.querySelectorAll('.node')).map(el => ({
    address: el.dataset.address, rect: pointIn(el.getBoundingClientRect()),
    height: el.getBoundingClientRect().height,
  }))
  const bySpan = {}
  for (const path of wires.querySelectorAll('path')) {
    const span = Math.abs((column[path.dataset.from] ?? 0) - (column[path.dataset.to] ?? 0))
    const length = path.getTotalLength()
    const hit = new Set()
    for (let at = 0; at <= length; at += 6) {
      const point = path.getPointAtLength(at)
      for (const box of boxes) {
        if (box.address === path.dataset.from || box.address === path.dataset.to || hit.has(box.address)) continue
        const r = box.rect
        if (point.x >= r.left && point.x <= r.right &&
            point.y >= r.middle - box.height / 2 && point.y <= r.middle + box.height / 2) hit.add(box.address)
      }
    }
    bySpan[span] = (bySpan[span] ?? 0) + hit.size
  }
  return bySpan
}

/**
 * Sweep the ranks until the wires stop finding fewer boxes to cross.
 *
 * One pass down the ranks and one back up. Ordering by parents pulls a rank
 * towards its left neighbour and ordering by children pulls it right, so a rank
 * in the middle answers to both only if both get a turn.
 *
 * The measurement decides, not the sweep. Each round gets rendered and counted,
 * and a round that makes the page worse gets thrown away — a barycentre pass
 * usually helps and is not guaranteed to.
 */
function settle(rounds = 6) {
  let best = overlaps()
  let bestOrder = ranks.map(rank => rank.groups)
  for (let round = 0; round < rounds; round++) {
    const forward = round % 2 === 0
    const order = forward ? ranks : [...ranks].reverse()
    for (const rank of order) orderRank(rank, forward ? parentsOf : childrenOf)
    numberRows()
    render()
    draw()
    const found = overlaps()
    if (found < best) { best = found; bestOrder = ranks.map(rank => rank.groups) }
    else { ranks.forEach((rank, i) => { rank.groups = bestOrder[i] }); render(); draw() }
  }
  return best
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
  // The document's name is the way out, rather than a separate line offering to
  // open it. A reader already reads that line to learn where the claim lives,
  // and the href carries the fragment, so following it lands on the claim
  // itself rather than the top of the file.
  const where = document.getElementById('pane-where')
  where.textContent = (node.kind || 'declaration') + ' in '
  const anchor = document.createElement('a')
  anchor.href = node.address.replace(/^docs\//, '')
  anchor.textContent = file
  where.appendChild(anchor)
  const detail = document.getElementById('pane-detail')
  detail.textContent = ''
  // A claim's reasoning is markup it wrote; a declaration's is the prose of its
  // own comment. Both read immediately, and only the code waits behind a
  // disclosure, since the reasoning is what a reader came for.
  if (node.detail) detail.innerHTML = node.detail
  if (node.doc) {
    const doc = document.createElement('p')
    doc.className = 'doc'
    doc.textContent = node.doc
    detail.appendChild(doc)
  }
  if (node.snippet) detail.appendChild(codeFor(node))
  const links = document.getElementById('pane-links')
  links.textContent = ''
  // Side by side, since the two read as a pair: what a claim answers to, and
  // what answers to it. A side with nothing in it stays out entirely rather
  // than leaving a heading over an empty column.
  for (const side of [
    neighbours('derives from', parentsOf[node.address]),
    neighbours('derived from it', childrenOf[node.address]),
  ]) if (side) links.appendChild(side)
  pane.hidden = false
}

/**
 * One step of the chain, as buttons rather than links.
 *
 * Following one moves the selection: the graph lights around the neighbour and
 * the pane fills from it, so a reader walks the chain without leaving the page.
 * The anchor at the bottom stays the only thing that opens a document.
 *
 * An empty side renders nothing at all, since a heading over no items tells a
 * reader the same thing its absence does.
 */
function neighbours(title, addresses) {
  const found = (addresses || []).map(nodeAt).filter(Boolean)
  if (!found.length) return null
  const box = document.createElement('div')
  box.className = 'side'
  const h = document.createElement('h3')
  h.textContent = title
  box.appendChild(h)
  for (const node of found) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = node.title || node.name
    button.addEventListener('click', () => show(node.address))
    box.appendChild(button)
  }
  return box
}

/**
 * Scroll a selected box out from under the pane.
 *
 * The pane floats over the bottom right corner, so selecting something down
 * there answers a click by hiding what was clicked. This moves the grid just
 * far enough that the box clears the pane's top edge, which is always possible
 * because the grid carries the pane's height as padding beneath its content.
 */
function clearOfPane(box) {
  if (!box || pane.hidden) return
  const b = box.getBoundingClientRect(), p = pane.getBoundingClientRect()
  const covered = b.bottom > p.top && b.top < p.bottom && b.right > p.left && b.left < p.right
  if (covered) grid.scrollTop += b.bottom - p.top + 12
}

let selected = null

/**
 * Light one node's chain, fill the pane from it, and bring it into view.
 *
 * The one place selection changes, so a click on the graph and a step through
 * the pane leave the page in the same state. Nothing else writes to `selected`.
 */
function show(address) {
  selected = address
  const lit = selected ? chainOf(selected) : null
  for (const el of grid.querySelectorAll('[data-address]')) {
    // Three states, not two. Lighting the chain says which claims are involved
    // and says nothing about which one a reader picked, so the one they picked
    // gets the full colour and the chain around it a little less.
    el.classList.toggle('chosen', el.dataset.address === selected)
    el.classList.toggle('lit', !!lit && lit.has(el.dataset.address))
    el.classList.toggle('dim', !!lit && !lit.has(el.dataset.address))
  }
  for (const path of wires.querySelectorAll('path'))
    path.classList.toggle('lit', !!lit && lit.has(path.dataset.from) && lit.has(path.dataset.to))
  fillPane(selected)
  if (selected) {
    const box = boxOf(selected)
    if (box) box.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    clearOfPane(box)
  }
}

// Clicking the graph toggles, because clicking what is already selected means
// putting it down. Stepping through the pane never does: a reader following the
// chain named a different node, and the one they came from is not it.
const toggle = (address) => show(address === selected ? null : address)

grid.addEventListener('click', (event) => {
  const box = event.target.closest('[data-address]')
  toggle(box && box.dataset.address)
})
document.getElementById('pane-close').addEventListener('click', () => show(null))

draw()

/**
 * Measuring the drawing, only when somebody asks for it.
 *
 * All of it costs real time: the sweep renders and redraws the whole page once
 * per round, and counting walks every wire at six-pixel steps against every
 * box. A reader opening the page waited through all of it and saw a number they
 * had not asked for.
 *
 * The sweep goes in here with the counting rather than staying on by default,
 * because it is only worth its cost while somebody is comparing arrangements.
 * It moved the last measurement by four out of a hundred and thirty-one; the
 * bands did the work.
 *
 * Written into the page rather than logged, so a person who does ask and a
 * script that asks see the same number.
 */
function measure() {
  const before = overlaps()
  const after = settle()
  const el = document.getElementById('crossings')
  el.textContent = after
  el.dataset.before = before
  el.dataset.bySpan = JSON.stringify(overlapsBySpan())
  el.dataset.collisions = collisions()
}

if (location.search.includes('measure')) measure()
else document.getElementById('crossings').closest('.stat').remove()

addEventListener('resize', draw)
