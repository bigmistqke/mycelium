// Drawing a ranked graph in a page: columns of boxes, wires between them, a
// pane carrying what a box says, and a way to measure the result.
//
// None of this knows what it is drawing. A caller hands over the ranks, the
// edges and a way to describe one address, and everything here works from that.
// The chain reads its ranks off a vocabulary of claims; the knowledge graph
// reads its columns off days. Neither difference reaches this file.
//
// It ran as one file with the chain's own ranking until a second drawing wanted
// the same page, which is the moment a helper stops belonging to one caller.
//
// Closed over its own names, because the page carries this and its caller in
// one script. Both files want to say `ranks` and `parentsOf`, and at the top
// level the second declaration is a syntax error that kills the page before it
// draws anything.
//
// @ts-check
"use strict"

/**
 * One box, in the shape every rank's own items array holds it. A caller
 * builds these; nothing here invents a field none of them set.
 *
 * @typedef {object} Item
 * @property {string} address
 * @property {string} [title]
 * @property {string} [kind]
 * @property {string} [group]
 * @property {string} [subsystem]
 * @property {number} [reach]
 * @property {string} [counts]
 * @property {string} [groupOf]
 * @property {boolean} [file]
 */

/**
 * Items sharing one group, ordered and placed by orderRank/numberRows.
 *
 * @typedef {object} Group
 * @property {string} name
 * @property {Item[]} items
 * @property {string} [groupOf]
 * @property {number} [band]
 * @property {number} [at]
 */

/**
 * One column. `groups` is filled in by orderRank, so a rank a caller just
 * built has items and nothing else yet.
 *
 * @typedef {object} Rank
 * @property {string} name
 * @property {Item[]} items
 * @property {Group[]} [groups]
 */

/** @typedef {{ from: string, to: string, rel?: string }} DrawnEdge */

/** A box's canvas position, as pointIn measures it off a getBoundingClientRect. */
/** @typedef {{ left: number, right: number, middle: number }} Placed */

/**
 * One column of a node's neighbours in the pane, as sidesFor or the default
 * two-column reading builds it.
 *
 * @typedef {object} Side
 * @property {string} title
 * @property {string} [rel]
 * @property {number} [column]
 * @property {string[]} [addresses]
 */

/**
 * Whatever the corpus knows about one address. Every field but address is
 * one claim type's own, so a node the pane fills from carries only the ones
 * its own kind set.
 *
 * @typedef {object} GraphNode
 * @property {string} address
 * @property {string} [title]
 * @property {string} [name]
 * @property {string} [kind]
 * @property {string} [prompt]
 * @property {string} [question]
 * @property {string} [snippet]
 * @property {string} [reading]
 * @property {string} [detail]
 * @property {string} [doc]
 * @property {string} [check]
 * @property {string} [fixture]
 */

/**
 * What a caller hands mount(): everything specific to what is being drawn.
 *
 * @typedef {object} Model
 * @property {Rank[]} ranks
 * @property {Record<string, string[]>} parentsOf
 * @property {string[]} bands
 * @property {(address: string) => GraphNode | undefined} nodeAt
 * @property {(address: string) => Set<string>} litFrom
 * @property {(address: string) => string} [impactFor]
 * @property {(address: string) => Side[]} [sidesFor]
 * @property {DrawnEdge[]} [edges]
 */

/**
 * An element this page's own markup always carries; absence is a broken page,
 * not a type worth threading through every caller.
 *
 * @param {string} id
 * @returns {HTMLElement}
 */
const need = (id) => /** @type {HTMLElement} */ (document.getElementById(id))

/**
 * Every match, typed as the div this page builds every one of them from.
 * querySelectorAll only infers a real element type from a bare tag name, and
 * every selector here is a class or an attribute, so without this the loop
 * variable comes back as the untyped base Element.
 *
 * @param {ParentNode} root
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
const allOf = (root, selector) => /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll(selector)))

/**
 * The wire layers are the one thing here drawn as SVG, so path methods below
 * (getTotalLength, getPointAtLength) resolve.
 *
 * @param {string} id
 * @returns {SVGSVGElement}
 */
const needSvg = (id) => /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.getElementById(id)))

const mountGraph = (() => {

const grid = need('grid')
const wires = needSvg('wires')
const litWires = needSvg('wires-lit')
const pane = need('pane')

/** What the caller supplies, filled in by mountGraph. */
/** @type {Rank[]} */
let ranks = []
/** @type {Record<string, string[]>} */
let parentsOf = {}
/** @type {Record<string, string[]>} */
let childrenOf = {}
/** @type {string[]} */
let bands = []
/** @type {(address: string) => GraphNode | undefined} */
let nodeAt = () => undefined
/** @type {(address: string) => Set<string>} */
let litFrom = (address) => new Set([address])
/** @type {(address: string) => string} */
let impactFor = () => ''
/** The colour standing for each kind of node, and the kind each address is. */
/** @type {Record<string, string>} */
const kindColour = {}
/** @type {Record<string, string>} */
const kindOf = {}
/** The colour standing for each relation, for the groups the pane lists. */
/** @type {Record<string, string>} */
const relColour = {}
/** Kinds a reader has switched off. Empty means everything shows. */
const hidden = new Set()
/** Whether the page listeners are already on, since mount can run more than once. */
let listening = false

/**
 * Which kinds a reader has switched off, kept in the address bar.
 *
 * This lived only in the set above, which survives a remount and not a reload —
 * and the page reloads whenever the drawing's own code changes. The address bar
 * survives both. It also makes a filtered view a link somebody can paste, the
 * same way the selected node in the hash already is.
 *
 * A query rather than the hash, because the hash already names the selection
 * and `measure` already reads a query. Written through replaceState, since
 * assigning to location.search would navigate away instead.
 */
function readFilters() {
  hidden.clear()
  const asked = new URLSearchParams(location.search).get('hide')
  for (const kind of (asked ?? '').split(',')) if (kind) hidden.add(kind)
}

function rememberFilters() {
  const query = new URLSearchParams(location.search)
  if (hidden.size) query.set('hide', [...hidden].join(','))
  else query.delete('hide')
  const search = query.toString()
  history.replaceState(null, '', location.pathname + (search ? '?' + search : '') + location.hash)
}
/**
 * Every address, under the shorter name the address bar shows.
 *
 * A hash is something a person reads and pastes, so it drops the .html that
 * says nothing. Kept as a lookup rather than a rule for putting the suffix
 * back, because reversing a transform means guessing at what got removed, and
 * the set of real addresses is right here.
 */
/** @type {Record<string, string>} */
const addressByHash = {}

/**
 * @param {string} address
 * @returns {string}
 */
const hashOf = (address) => address.replace(/\.html(?=$|#)/, '')

/** @type {(address: string) => Side[]} */
let sidesFor = (address) => [
  { title: 'answers to', column: 0, addresses: parentsOf[address] },
  { title: 'answered by', column: 1, addresses: childrenOf[address] },
]

/**
 * @param {Item} item
 * @returns {number}
 */
const bandOf = (item) => {
  const at = bands.indexOf(item.subsystem ?? '')
  return at === -1 ? bands.length : at
}

/** @type {Record<string, number>} */
const row = {}

/**
 * Order one rank, keeping each band together.
 *
 * `neighbours` decides which way the sweep looks. Ordering a rank by where its
 * parents sit pulls it towards the rank on its left; ordering it by its
 * children pulls it towards the rank on its right. Alternating the two is what
 * lets a middle rank answer to both, instead of only to whichever side the
 * first pass came from.
 *
 * The band always wins. A band holds one stretch of every column whatever the
 * means say, so the sweep decides the order inside a band and never across
 * bands.
 *
 * @param {Rank} rank
 * @param {Record<string, string[]>} neighbours
 * @returns {void}
 */
function orderRank(rank, neighbours) {
  /**
   * @param {Item} item
   * @returns {number}
   */
  const mean = (item) => {
    const ns = (neighbours[item.address] || []).map(a => row[a]).filter(n => n !== undefined)
    return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : Number.MAX_SAFE_INTEGER
  }
  /** @type {Map<string | undefined, Item[]>} */
  const groups = new Map()
  for (const item of rank.items) {
    if (!groups.has(item.group)) groups.set(item.group, [])
    groups.get(item.group)?.push(item)
  }
  for (const items of groups.values()) items.sort((a, b) => mean(a) - mean(b))
  rank.groups = [...groups.entries()]
    .map(([name, items]) => ({ name: name ?? '', items, groupOf: items[0].groupOf, band: bandOf(items[0]),
      at: items.reduce((n, i) => n + (mean(i) === Number.MAX_SAFE_INTEGER ? 0 : mean(i)), 0) / items.length }))
    .sort((a, b) => a.band - b.band || a.at - b.at)
}

/** Every item's position in its own column, which is what a mean averages. */
function numberRows() {
  for (const rank of ranks) {
    let n = 0
    // Always set by orderRank, which every caller runs first — there is no
    // path from an empty rank.groups to here.
    for (const group of rank.groups ?? []) for (const item of group.items) row[item.address] = n++
  }
}

/**
 * Code without the indentation of whatever markup held it.
 *
 * A script inside a document sits wherever its element sits, so its lines carry
 * two or six spaces that belong to the page rather than to the code. The
 * reading trims the block, which strips the first line's indent and leaves
 * every other line's, and the pane then shows code that steps right at line
 * two.
 *
 * Reading the shallowest line rather than assuming a width, since one corpus
 * holds scripts at three different depths.
 *
 * @param {string} source
 * @returns {string}
 */
function dedent(source) {
  const lines = source.split('\n')
  const depths = lines.slice(1).filter((line) => line.trim()).map((line) => (line.match(/^ */) ?? [''])[0].length)
  if (!depths.length) return source
  const cut = Math.min(...depths)
  return [lines[0], ...lines.slice(1).map((line) => line.slice(cut))].join('\n')
}

/**
 * A block of source behind a disclosure.
 *
 * Only the code sits here. The prose introducing it reads immediately beside
 * the claim, because that is the reasoning a reader came for, and the code is
 * what they open when the reasoning is not enough.
 *
 * Four things arrive here and each means something different: the declaration a
 * claim answers for, the script that measured the corpus, the check that
 * falsifies a claim, and the fixture that check runs against. The summary says
 * which, since a reader decides whether to open it from that word alone.
 *
 * @behaviour canon/chain.canon.html#the-drawing-carries-the-comment-and-the-code
 * @param {string} text
 * @param {{ label?: string, lang?: string, section?: boolean }} [options]
 * @returns {HTMLDetailsElement}
 */
function codeFor(text, { label = 'implementation', lang = 'typescript', section = false } = {}) {
  const source = dedent(text)
  const d = document.createElement('details')
  // A disclosure inside a report is one of its sections, so its summary is that
  // section's header. The class goes on the disclosure and the styling on the
  // summary alone: a header's own styling includes uppercasing, and the code
  // inherits anything the container carries.
  if (section) d.className = 'section-fold'
  const summary = document.createElement('summary')
  summary.textContent = label
  d.appendChild(summary)
  const holder = document.createElement('div')
  holder.className = 'code'
  const pre = document.createElement('pre')
  pre.textContent = source
  holder.appendChild(pre)
  d.appendChild(holder)
  paint(holder, source, lang)
  return d
}

/**
 * Colour a block of code once a highlighter has loaded.
 *
 * The page shows the code first and colours it afterwards, so a reader who
 * opens the pane offline still reads the code. Nothing waits on the network to
 * render.
 *
 * The caller names the language, since a fixture is markup and everything else
 * here is code, and markup coloured as TypeScript reads as one long string.
 *
 * @param {HTMLElement} holder
 * @param {string} source
 * @param {string} lang
 * @returns {Promise<void>}
 */
async function paint(holder, source, lang) {
  try {
    const { codeToHtml } = await shiki()
    holder.innerHTML = await codeToHtml(source, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    })
  } catch {
    // A page opened with no network keeps the plain text it already has.
  }
}

/** @type {Promise<{ codeToHtml: (source: string, options: object) => Promise<string> }> | undefined} */
let shikiOnce = undefined
const shiki = () =>
  // A URL specifier, resolved by the browser at runtime and never on disk, so
  // nothing here can offer TypeScript a module to find.
  // @ts-expect-error
  (shikiOnce ??= import('https://esm.sh/shiki@1.24.0'))

/**
 * One box.
 *
 * The kind rides on the box as a colour and not as a word: the heading over the
 * group already names it, so spelling it again on every box spent a line
 * repeating what sat directly above.
 *
 * The badge says something different on each rank, so it carries what it counts
 * rather than leaving a bare number to guess at.
 *
 * @param {Item} item
 * @returns {HTMLElement}
 */
function boxFor(item) {
  const el = document.createElement('div')
  el.className = 'node' + (item.file ? ' file' : '')
  el.dataset.address = item.address
  if (item.kind) {
    el.dataset.kind = item.kind
    el.style.setProperty('--wire', kindColour[item.kind])
  }
  el.innerHTML = (item.reach === undefined ? ''
      : '<span class="reach" title="' + item.counts + '">' + item.reach + '</span>')
    + '<span class="title"></span>'
  const title = el.querySelector('.title')
  if (title) title.textContent = item.title ?? ''
  return el
}

/**
 * @param {Group} group
 * @returns {HTMLElement}
 */
function groupBox(group) {
  const g = document.createElement('div')
  g.className = 'group'
  const h = document.createElement('h3')
  h.textContent = group.name
  // A group heading is selectable when it stands for something addressable, so
  // a whole grouping lights at once.
  if (group.groupOf) { h.dataset.address = group.groupOf; h.className = 'selectable' }
  g.appendChild(h)
  for (const item of group.items) g.appendChild(boxFor(item))
  return g
}

/**
 * The whole grid: a column per rank, and a row per band.
 *
 * A band gets the same row in every column, so it occupies one stripe across
 * the page and the edges inside it stay in that stripe. Packing each column top
 * to bottom instead put a band at the top of one column and halfway down the
 * next, which is why its edges ran diagonally over everything between them.
 *
 * A band with nothing in a column leaves its cell empty. That whitespace is the
 * point: it is what holds the rest in line, and a page that fills it has gone
 * back to the arrangement this replaces.
 *
 * Called again whenever a sweep reorders anything, so what is on screen is
 * always the arrangement being measured.
 *
 * @returns {void}
 */
function render() {
  for (const cell of allOf(grid, '.rank, .cell, .headband')) cell.remove()
  // Always set by orderRank, which every caller of render runs first.
  const used = bands.filter(band => ranks.some(rank => (rank.groups ?? []).some(g => g.band === bands.indexOf(band))))
  const loose = ranks.some(rank => (rank.groups ?? []).some(g => (g.band ?? 0) >= bands.length))

  /**
   * A backdrop under the headings, spanning every column so the gaps between
   * them are covered too. Each heading sticks on its own, and without this the
   * boxes scroll through the space between one heading and the next.
   */
  const backdrop = document.createElement('div')
  backdrop.className = 'headband'
  backdrop.style.gridRow = '1'
  backdrop.style.gridColumn = '1 / -1'
  grid.appendChild(backdrop)

  ranks.forEach((rank, column) => {
    const head = document.createElement('div')
    head.className = 'rank'
    head.innerHTML = rank.name ? '<h2>' + rank.name + '</h2>' : '<h2>&nbsp;</h2>'
    head.style.gridColumn = String(column + 1)
    head.style.gridRow = '1'
    grid.appendChild(head)

    const rows = [...used.map(band => bands.indexOf(band)), ...(loose ? [bands.length] : [])]
    rows.forEach((band, index) => {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.style.gridColumn = String(column + 1)
      cell.style.gridRow = String(index + 2)
      for (const group of (rank.groups ?? []).filter(g => g.band === band)) {
        const showing = group.items.filter((item) => !hidden.has(item.kind ?? ''))
        if (showing.length) cell.appendChild(groupBox({ ...group, items: showing }))
      }
      grid.appendChild(cell)
    })
  })
}

/** @type {DrawnEdge[]} */
let links = []

/**
 * @param {string} address
 * @returns {HTMLElement | null}
 */
const boxOf = (address) => grid.querySelector('[data-address="' + CSS.escape(address) + '"]')

/**
 * Where a box sits on the canvas the wires run across.
 *
 * The browser measures a box against the viewport, and the canvas covers the
 * grid's whole content rather than the part of it on screen. So the grid's own
 * visible corner comes off, and whatever it has scrolled goes back on. Leaving
 * the scroll out draws every wire at the offset the reader last scrolled by,
 * which looks like a layout fault and is a stale measurement.
 *
 * @param {DOMRect} rect
 * @returns {Placed}
 */
function pointIn(rect) {
  const origin = grid.getBoundingClientRect()
  return {
    left: rect.left - origin.left + grid.scrollLeft,
    right: rect.right - origin.left + grid.scrollLeft,
    middle: rect.top - origin.top + grid.scrollTop + rect.height / 2,
  }
}

/**
 * Which side of a box a wire leaves and arrives on.
 *
 * Read off where the two boxes actually sit rather than which end of the edge
 * is which. A wire meaning one thing runs either way here, since a day's edges
 * reach back to earlier days and forward to later ones. Tying the side to the
 * relation drew half of them looping backwards out of the wrong edge.
 *
 * Two boxes sharing a column use the same side at both ends, since neither sits
 * left of the other and a wire between them has to bow out somewhere.
 *
 * @param {Placed} ra
 * @param {Placed} rb
 * @returns {[number, number]}
 */
function sidesOf(ra, rb) {
  if (ra.right <= rb.left) return [ra.right, rb.left]
  if (rb.right <= ra.left) return [ra.left, rb.right]
  return [ra.right, rb.right]
}

/** @returns {void} */
function draw() {
  for (const layer of [wires, litWires]) {
    layer.setAttribute('viewBox', '0 0 ' + grid.scrollWidth + ' ' + grid.scrollHeight)
    layer.style.width = grid.scrollWidth + 'px'
    layer.style.height = grid.scrollHeight + 'px'
    layer.innerHTML = ''
  }
  for (const { from, to, rel } of links) {
    const a = boxOf(from), b = boxOf(to)
    if (!a || !b) continue
    const ra = pointIn(a.getBoundingClientRect()), rb = pointIn(b.getBoundingClientRect())
    const [x1, x2] = sidesOf(ra, rb)
    const y1 = ra.middle, y2 = rb.middle
    const mid = (x1 + x2) / 2
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M' + x1 + ',' + y1 + ' C' + mid + ',' + y1 + ' ' + mid + ',' + y2 + ' ' + x2 + ',' + y2)
    path.dataset.from = from
    path.dataset.to = to
    // A wire takes its relation's colour, which is the colour the pane puts
    // beside that relation's group. One legend: a node's colour says what it
    // is, an edge's says what kind of step it is.
    if (rel && relColour[rel]) {
      path.dataset.rel = rel
      path.style.setProperty('--wire', relColour[rel])
    }
    wires.appendChild(path)
  }
}

/**
 * How many boxes the wires currently run across.
 *
 * A wire from one column to the next has a gap to itself and crosses nothing.
 * The overlaps come from the long ones, which pass over every column between
 * their ends and whatever sits in those columns at that height.
 *
 * Measured off the drawn paths rather than recomputed, so this counts what a
 * reader sees. Sampling the curve rather than solving it: a wire crossing a box
 * spends many points inside it, and a sample fine enough to matter is cheaper
 * than the arithmetic that would be exact.
 *
 * @returns {number}
 */
function overlaps() {
  const boxes = allOf(grid, '.node').map(el => ({
    address: el.dataset.address,
    rect: pointIn(el.getBoundingClientRect()),
    height: el.getBoundingClientRect().height,
  }))
  let count = 0
  for (const path of wires.querySelectorAll('path')) {
    const length = path.getTotalLength()
    const hit = new Set()
    for (let at = 0; at <= length; at += 6) {
      const point = path.getPointAtLength(at)
      for (const box of boxes) {
        if (box.address === path.dataset.from || box.address === path.dataset.to || hit.has(box.address)) continue
        const r = box.rect
        if (point.x >= r.left && point.x <= r.right &&
            point.y >= r.middle - box.height / 2 && point.y <= r.middle + box.height / 2) {
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
 *
 * @returns {number}
 */
function collisions() {
  const boxes = allOf(grid, '.node').map(el => el.getBoundingClientRect())
  let count = 0
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j]
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) count++
    }
  return count
}

/**
 * The same count, split by how far a wire travels.
 *
 * Ordering and placement only reach the short ones. A wire spanning several
 * columns passes over whatever fills those columns whatever the layout does.
 *
 * @returns {Record<string, number>}
 */
function overlapsBySpan() {
  /** @type {Record<string, number>} */
  const column = {}
  allOf(grid, '.rank, .cell').forEach(cell => {
    for (const el of allOf(cell, '[data-address]')) column[el.dataset.address ?? ''] = Number(cell.style.gridColumn)
  })
  const boxes = allOf(grid, '.node').map(el => ({
    address: el.dataset.address, rect: pointIn(el.getBoundingClientRect()),
    height: el.getBoundingClientRect().height,
  }))
  /** @type {Record<string, number>} */
  const bySpan = {}
  for (const path of wires.querySelectorAll('path')) {
    const span = Math.abs((column[path.dataset.from ?? ''] ?? 0) - (column[path.dataset.to ?? ''] ?? 0))
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

/**
 * Where a node lives, with the document's name carrying the way out.
 *
 * A reader already reads this line to learn where the node sits, so the name in
 * it is the link rather than a separate row offering to open something. The
 * href keeps the fragment, so following it lands on the node itself and not the
 * top of the file.
 *
 * @param {GraphNode} node
 * @returns {void}
 */
function fillWhere(node) {
  const where = need('pane-where')
  where.textContent = (node.kind || 'declaration') + ' in '
  const anchor = document.createElement('a')
  // The address already names the file relative to the corpus, which is what a
  // published site serves and what a --base resolves against, so it doubles as
  // its own href. Two `docs/` strippers used to sit here from when the corpus
  // lived there; both had stopped matching anything long before anyone noticed.
  anchor.href = node.address
  anchor.textContent = node.address.split('#')[0]
  where.appendChild(anchor)
}

/**
 * The blast radius, up top where a reader meets it before the reasoning.
 *
 * The caller writes the sentence, because the thing being counted is its own
 * vocabulary. Saying it here put behaviours into a drawing that draws notebook
 * entries instead, and a reader met a word for something the graph in front of
 * them does not contain.
 *
 * A caller with nothing worth saying says nothing, which is why an empty string
 * hides the line rather than needing a second flag.
 *
 * @param {GraphNode} node
 * @returns {void}
 */
function fillReach(node) {
  const reach = need('pane-reach')
  reach.textContent = impactFor(node.address)
  reach.hidden = !reach.textContent
  // The line beside it takes the whole width when nothing sits there, rather
  // than stopping at the halfway mark against an empty half.
  need('pane-meta').classList.toggle('alone', reach.hidden)
}

/**
 * The header naming one section of a report, drawn only when that section has
 * something under it.
 *
 * An empty section with a header reads as a bug in the page. The same section
 * missing entirely reads as an experiment somebody has not finished, which is
 * the true statement.
 *
 * @param {string} label
 * @returns {HTMLHeadingElement}
 */
function sectionHeader(label) {
  const head = document.createElement('h3')
  head.className = 'section'
  head.textContent = label
  return head
}

/**
 * Whatever reasoning the node carries, and the code it names behind a
 * disclosure.
 *
 * A claim's reasoning is markup it wrote and a declaration's is the prose of
 * its own comment. Both read immediately, and only the code waits, since the
 * reasoning is what a reader came for.
 *
 * An experiment is a report rather than a paragraph, and its four fields play
 * four roles: the question it asked, the script that answered it, the reading
 * that came back, and the prose reading that back. Naming them in the page is
 * what separates a report from a column of prose, so each gets a header.
 *
 * They run in the order somebody ran them, and the method sits second and
 * folded. Unfolded there it would put a thousand characters of code between the
 * question and the finding; left to the end it would break the order the
 * sections otherwise read in. The fold is what protects the finding, not the
 * position, so the position can stay honest.
 *
 * A claim ends with the check that falsifies it, folded the same way and last.
 * Everything above it is what the project says, and the check is the one thing
 * on the page that can argue back.
 *
 * @param {GraphNode} node
 * @returns {void}
 */
function fillDetail(node) {
  const detail = need('pane-detail')
  detail.textContent = ''
  // The prompt first and quoted, because it is the one thing here somebody else
  // said. Everything under it answers it, and a reader meeting the answer
  // before the question has to work backwards.
  if (node.prompt) {
    const quote = document.createElement('blockquote')
    quote.textContent = node.prompt
    detail.appendChild(quote)
  }
  // Only an experiment carries a question, and only an experiment gets headers.
  // One blob of prose needs no signposting, so every other entry reads exactly
  // as it did before any of this.
  const report = Boolean(node.question)
  // The title only abbreviates the question. Where the two say the same words
  // the pane says them once, since a title short enough to scan in a column of
  // boxes is a different job from a question worth asking.
  if (node.question && node.question !== node.title) {
    detail.appendChild(sectionHeader('question'))
    const asked = document.createElement('p')
    asked.className = 'question'
    asked.textContent = node.question
    detail.appendChild(asked)
  }
  // The method, folded, with its own header doing the unfolding. A label above
  // a disclosure would say the same word twice.
  if (report && node.snippet) detail.appendChild(codeFor(node.snippet, { label: 'method', section: true }))
  if (node.reading) {
    if (report) detail.appendChild(sectionHeader('data'))
    const reading = document.createElement('p')
    reading.className = 'reading'
    reading.textContent = node.reading
    detail.appendChild(reading)
  }
  if (node.detail && report) detail.appendChild(sectionHeader('conclusion'))
  if (node.detail) detail.insertAdjacentHTML('beforeend', node.detail)
  if (node.doc) {
    const doc = document.createElement('p')
    doc.className = 'doc'
    doc.textContent = node.doc
    detail.appendChild(doc)
  }
  if (!report && node.snippet) detail.appendChild(codeFor(node.snippet))
  // A claim's check, last and folded, because it is what a reader opens when
  // the claim alone does not convince them. Its fixture goes beside it rather
  // than inside it: the case and what the case runs against are two things, and
  // a reader opening one has no use for the other.
  if (node.check) detail.appendChild(codeFor(node.check, { label: 'check' }))
  if (node.fixture) detail.appendChild(codeFor(node.fixture, { label: 'fixture', lang: 'html' }))
}

/**
 * One step out of a node, in whatever groups the caller names.
 *
 * A generic pair — what this derives from, what derives from it — said less
 * than the edges already do. A graph whose relations mean different things
 * names its own groups, so a reader sees which kind of step each neighbour is
 * rather than which direction it happens to run.
 *
 * A lone group takes the whole width, decided here rather than left to a
 * selector, because any sibling added later would quietly break a rule that
 * asks whether a group is on its own.
 */
/**
 * A node's neighbours in two columns: what it comes from on the left, what it
 * goes towards on the right.
 *
 * The same direction the graph itself runs, so a reader turning from the
 * drawing to the pane finds upstream where upstream already was. Relations
 * stack inside their column rather than each taking one, since which way a step
 * runs is the coarser question and the relation is the finer one.
 *
 * Which side a group belongs on comes from the caller, which states it per
 * relation rather than deriving it. Deriving it answered the question with a
 * fact about where an edge is stored, and a reader is looking at a claim.
 *
 * A node with steps in only one direction gives that column the whole width,
 * rather than leaving half the pane holding a rule and nothing else.
 *
 * @param {GraphNode} node
 * @returns {void}
 */
function fillSides(node) {
  const box = need('pane-links')
  box.textContent = ''
  const sides = sidesFor(node.address)
  const columns = [0, 1]
    .map((column) => sides.filter((side) => (side.column ?? 0) === column).map(neighbours).filter((el) => el !== null))
    .filter((group) => group.length)
  box.style.gridTemplateColumns = `repeat(${columns.length}, minmax(0, 1fr))`
  columns.forEach((group, at) => {
    const column = document.createElement('div')
    column.className = at === 0 ? 'column' : 'column follows'
    for (const side of group) column.appendChild(side)
    box.appendChild(column)
  })
}

/**
 * Fill the pane from one node, or hide it when nothing is selected.
 *
 * One shape for every rank, so the gesture stays uniform and a reader never
 * learns which boxes reward a click.
 *
 * @behaviour canon/chain.canon.html#the-drawing-carries-the-comment-and-the-code
 * @param {string | null} address
 * @returns {void}
 */
function fillPane(address) {
  const node = address && nodeAt(address)
  if (!node) { pane.hidden = true; return }
  need('pane-title').textContent = node.title || node.name || ''
  fillWhere(node)
  fillReach(node)
  fillDetail(node)
  fillSides(node)
  pane.hidden = false
}

/**
 * One step of the graph, as buttons rather than links.
 *
 * Following one moves the selection: the graph lights around the neighbour and
 * the pane fills from it, so a reader walks the chain without leaving the page.
 * The anchor in the line above stays the only thing that opens a document.
 *
 * An empty side renders nothing at all, since a heading over no items tells a
 * reader the same thing its absence does.
 *
 * @param {Side} side
 * @returns {HTMLElement | null}
 */
function neighbours(side) {
  const found = (side.addresses || []).map(nodeAt).filter((el) => el !== undefined)
  if (!found.length) return null
  const box = document.createElement('div')
  box.className = 'side'
  const h = document.createElement('h3')
  // A dot in the relation's own colour, so a group heading and the kind of step
  // it names are one thing rather than a word a reader has to hold.
  if (side.rel && relColour[side.rel]) {
    const dot = document.createElement('span')
    dot.className = side.column === 0 ? 'dot hollow' : 'dot'
    dot.style.setProperty('--wire', relColour[side.rel])
    h.appendChild(dot)
  }
  h.appendChild(document.createTextNode(side.title))
  box.appendChild(h)
  for (const node of found) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = node.title || node.name || ''
    // The same colour the box carries in the graph, so a step through the pane
    // and the box it lands on are recognisably the same thing.
    const kind = kindOf[node.address]
    if (kind) {
      button.dataset.kind = kind
      button.style.setProperty('--wire', kindColour[kind])
    }
    button.addEventListener('click', () => show(node.address))
    box.appendChild(button)
  }
  return box
}


/** @type {string | null} */
let selected = null

/**
 * Whether a box is already somewhere a reader can see it: inside #grid's
 * own visible area.
 *
 * Against #grid's rect rather than the window's. #grid gives up width to
 * the pane's column when it opens — its own box narrows, and a box whose
 * position was clear of the window is not clear of #grid's new, narrower
 * edge; getBoundingClientRect ignores that an ancestor's overflow clips it
 * there. #grid's rect already carries however much room it currently has,
 * pane open or closed, so checking against it is the one comparison that
 * covers both.
 *
 * @param {HTMLElement} box
 * @returns {boolean}
 */
function isVisible(box) {
  const rect = box.getBoundingClientRect()
  const bounds = grid.getBoundingClientRect()
  return rect.top >= bounds.top && rect.left >= bounds.left &&
         rect.bottom <= bounds.bottom && rect.right <= bounds.right
}

/**
 * Light one node's chain, fill the pane from it, and bring it into view.
 *
 * The one place selection changes, so a click on the graph and a step through
 * the pane leave the page in the same state. Nothing else writes to `selected`.
 *
 * @param {string | null} address
 * @returns {void}
 */
function show(address) {
  selected = address
  const lit = selected ? litFrom(selected) : null
  for (const el of allOf(grid, '[data-address]')) {
    // Three states, not two. Lighting the chain says which nodes are involved
    // and says nothing about which one a reader picked, so the one they picked
    // gets the full colour and the chain around it a little less.
    el.classList.toggle('chosen', el.dataset.address === selected)
    el.classList.toggle('lit', !!lit && lit.has(el.dataset.address ?? ''))
    el.classList.toggle('dim', !!lit && !lit.has(el.dataset.address ?? ''))
  }
  // The lit wires move to a layer above the boxes, and only those. A wire
  // behind a box is what keeps the drawing readable at rest; a lit one is the
  // thing a reader just asked to follow, and following it under a box is not
  // following it.
  litWires.innerHTML = ''
  for (const path of wires.querySelectorAll('path')) {
    const on = !!lit && lit.has(path.dataset.from ?? '') && lit.has(path.dataset.to ?? '')
    path.classList.toggle('lit', on)
    if (on) litWires.appendChild(path.cloneNode())
  }
  // The pane's own column has to open or close before isVisible measures
  // #grid below — showing or hiding it changes how wide #grid's own 1fr
  // column is, which moves every box inside it.
  fillPane(selected)
  if (selected) {
    const box = boxOf(selected)
    // The pane sits in its own column now, never over #grid's, so nothing
    // here needs to account for it geometrically — only whether the box is
    // already on screen. A reader who can already see the node they picked
    // does not want the page to move.
    if (box && !isVisible(box)) box.scrollIntoView({ block: 'center', inline: 'center' })
  }
  rememberSelection()
}

/**
 * Keep the address bar on the selected node, so a link to a drawing can be a
 * link to a place in it.
 *
 * Written as a hash rather than a query, since nothing about it needs the
 * server, and it lands in history so stepping through the pane can be walked
 * back. Clearing the selection drops the hash entirely instead of leaving a
 * bare one behind.
 */
function rememberSelection() {
  const want = selected ? '#' + encodeURIComponent(hashOf(selected)) : ''
  if (location.hash === want) return
  if (want) location.hash = want
  else history.replaceState(null, '', location.pathname + location.search)
}

/**
 * Follow the address bar, whichever way it changed.
 *
 * A reader who opened the page at a node, and one who pressed back after
 * clicking three of them, both arrive here. Selecting only when the address
 * differs from what is already selected is what keeps this from answering the
 * hash it just wrote.
 *
 * @returns {void}
 */
function followHash() {
  const asked = decodeURIComponent(location.hash.slice(1))
  if (!asked) { if (selected) show(null); return }
  const address = addressByHash[asked]
  if (!address || address === selected) return
  show(address)
}

/**
 * Clicking the graph toggles, because clicking what is already selected means
 * putting it down.
 *
 * Stepping through the pane never does: a reader following the chain named a
 * different node, and the one they came from is not it.
 *
 * @param {string | null} address
 * @returns {void}
 */
const toggle = (address) => show(address === selected ? null : address)

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
 *
 * Written into the page rather than logged, so a person who does ask and a
 * script that asks see the same number.
 *
 * @returns {void}
 */
function measure() {
  const before = overlaps()
  const after = settle()
  const el = need('crossings')
  el.textContent = String(after)
  el.dataset.before = String(before)
  el.dataset.bySpan = JSON.stringify(overlapsBySpan())
  el.dataset.collisions = String(collisions())
}

/**
 * A switch per kind, so a reader can put one aside without losing it.
 *
 * Nothing is special-cased. The kinds come from what the graph actually holds,
 * so a corpus that grows a type grows a switch, and neither drawing needs to
 * know which kinds somebody finds noisy today.
 *
 * Switching one off leaves it out of the drawing entirely rather than fading
 * it. A box nobody wants to read is still a box in the way, and the wires that
 * reached it go with it, since a wire to nothing is a line to nowhere.
 *
 * @returns {void}
 */
function buildFilters() {
  const box = need('filters')
  // Emptied before rebuilding, because mount runs again whenever the corpus
  // moves under a watching page, and appending would leave one row of chips per
  // redraw.
  box.textContent = ''
  for (const kind of Object.keys(kindColour)) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.textContent = kind
    chip.style.setProperty('--wire', kindColour[kind])
    // What the address bar asked for, so a pasted link and a redrawn page both
    // open showing what the reader chose.
    chip.classList.toggle('off', hidden.has(kind))
    chip.addEventListener('click', () => {
      if (hidden.has(kind)) hidden.delete(kind)
      else hidden.add(kind)
      chip.classList.toggle('off', hidden.has(kind))
      rememberFilters()
      render()
      draw()
      // A selection whose kind just went away stops being a selection.
      show(selected && hidden.has(kindOf[selected] ?? '') ? null : selected)
    })
    box.appendChild(chip)
  }
}

/**
 * Draw what a caller describes, and hand the page over to a reader.
 *
 * Everything specific arrives here: which ranks exist, which edges join what,
 * which bands hold a stripe, and how to describe one address for the pane. What
 * happens after is the same whatever answered those.
 *
 * @param {Model} model
 * @returns {void}
 */
function mount(model) {
  ranks = model.ranks
  parentsOf = model.parentsOf
  bands = model.bands
  nodeAt = model.nodeAt
  litFrom = model.litFrom
  impactFor = model.impactFor ?? (() => '')
  if (model.sidesFor) sidesFor = model.sidesFor

  // Emptied rather than written over, because a watching page mounts again on
  // every change and a key left behind names a node the new drawing does not
  // contain. The filters read back from the address bar instead, since those
  // are the reader's and not the corpus's.
  for (const map of [kindColour, kindOf, addressByHash, relColour])
    for (const key of Object.keys(map)) delete map[key]
  readFilters()

  /**
   * One hue per kind, spread evenly around the wheel.
   *
   * Computed rather than listed, because each graph names its own kinds and a
   * palette written down would have to know every vocabulary and go stale when
   * one gains a kind. Even lightness and chroma keep them level against each
   * other, and readable whichever way the reader's theme runs.
   */
  const kinds = /** @type {string[]} */ ([...new Set(ranks.flatMap((rank) => rank.items.map((item) => item.kind)).filter(Boolean))])
  kinds.forEach((kind, at) => {
    kindColour[kind] = `oklch(66% 0.19 ${Math.round((360 * at) / kinds.length)})`
  })
  for (const rank of ranks) for (const item of rank.items) {
    kindOf[item.address] = item.kind ?? ''
    addressByHash[hashOf(item.address)] = item.address
  }

  // The reverse, built here and thrown away, the same as every other downward
  // reach on this page. One step only: the pane lists what a node touches
  // directly, and the whole chain beneath it is what lighting the graph shows.
  childrenOf = {}
  for (const [child, parents] of Object.entries(parentsOf))
    for (const parent of parents) (childrenOf[parent] ??= []).push(child)

  // What gets drawn, which is not what gets ranked. Ranking asks which node
  // sits upstream; drawing asks which pair the corpus actually joined, and a
  // wire carries the colour of the node its edge leaves.
  links = model.edges ?? Object.entries(parentsOf)
    .flatMap(([child, parents]) => parents.map((parent) => ({ from: child, to: parent })))

  // The same spread for relations, which the pane groups by. A relation and a
  // kind answer different questions in different places, so they take their
  // colours from separate wheels rather than sharing one and colliding.
  const rels = /** @type {string[]} */ ([...new Set(links.map((link) => link.rel).filter(Boolean))])
  rels.forEach((rel, at) => {
    relColour[rel] = `oklch(68% 0.21 ${Math.round((360 * at) / rels.length + 20)})`
  })
  for (const rank of ranks) orderRank(rank, parentsOf)
  numberRows()
  render()
  buildFilters()
  grid.style.gridTemplateColumns = 'repeat(' + ranks.length + ', minmax(160px, 1fr))'

  // Registered once however many times mount runs. Registering twice makes one
  // click toggle twice and net to nothing, which reads as a page that has
  // stopped responding rather than as a page listening too well.
  const firstMount = !listening
  if (!listening) {
    listening = true
    grid.addEventListener('click', (event) => {
      const target = /** @type {HTMLElement | null} */ (event.target)
      const box = target?.closest('[data-address]')
      toggle(box instanceof HTMLElement ? (box.dataset.address ?? null) : null)
    })
    need('pane-close').addEventListener('click', () => show(null))
    addEventListener('resize', draw)
    addEventListener('hashchange', followHash)
  }

  draw()
  // The stat is already gone by the second mount, so both steps ask rather than
  // assume. Reaching through a removed element threw, and it threw after the
  // drawing had gone up, which makes a working page look like a broken one.
  if (location.search.includes('measure')) measure()
  else document.getElementById('crossings')?.closest('.stat')?.remove()
  followHash()
  // A caller ranking its columns by time wants the newest one on screen
  // first, not the column a reader would have to scroll a whole corpus to
  // reach. Only on the page's own first draw, and only if the hash above
  // did not already bring a specific node into view — a direct link to one
  // entry is a reader's own choice about where to land, and this must not
  // override it.
  if (firstMount && model.scrollToEnd && !selected) grid.scrollLeft = grid.scrollWidth
}

return mount
})()
