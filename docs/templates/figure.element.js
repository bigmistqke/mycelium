// Behaviour for the figure-* vocabulary. A classic script on purpose, and not a
// module: a document here opens over file://, module scripts are CORS-checked,
// and that origin cannot satisfy the check. The spec that deleted runtime.js
// describes the same constraint.
//
// Reading this as a workaround gets it backwards. customElements is a global
// registry, so registering an element is a global side effect however the
// script arrives, and there is no module-scoped version of that to give up.
//
// Typed through JSDoc, and checked by the line below. TypeScript is what a
// mycelium/* script may use, and this file is browser code, so its types have
// to live somewhere a browser will not choke on. The directive turns checking
// on for this file alone: the config leaves checkJs off, because a script
// written for a browser should hand its types to an importer without being
// linted against a config it was never written for.
// @ts-check
;(function () {
  "use strict"

  /**
   * @typedef {{ row: number, column: number }} Cell
   * @typedef {{ left: number, top: number, right: number, bottom: number, midX: number, midY: number }} Box
   * @typedef {{ left: number, top: number }} Origin
   * @typedef {{ top: number, bottom: number }} Span
   * @typedef {{ x: number, y: number }} Point
   */

  /**
   * One edge, gathered before anything routes it. The fields after `text` are
   * filled in as the passes run: boxes, then landings, then a lane, then the
   * path itself and where its label may go.
   *
   * @typedef {object} Edge
   * @property {string | null} fromId
   * @property {string | null} toId
   * @property {Element} fromNode
   * @property {Element} toNode
   * @property {boolean} back
   * @property {boolean} peer
   * @property {string} text
   * @property {Box} [a]
   * @property {Box} [b]
   * @property {Box} [marker]
   * @property {HTMLElement} [slot]
   * @property {number} [arriveX]
   * @property {number} [lane]
   * @property {number} [laneIndex]
   * @property {string} [d]
   * @property {Point | null} [labelAt]
   * @property {Span | null} [labelBand]
   * @property {Span | null} [labelGap]
   */

  /**
   * An edge whose two boxes have been measured, which is every edge once the
   * measuring pass has run. Spelling the stages as separate types keeps the
   * arithmetic free of checks for fields that are always there by then.
   *
   * @typedef {Edge & { a: Box, b: Box }} Measured
   */

  /**
   * A label on its way to a position.
   *
   * `w` and `h` come from measuring the chip, which is the only way to know how
   * wide a word renders. The measuring happens once, the moment the chip joins
   * the document, rather than again in every pass that wants it. `cx` starts at
   * the anchor and ends wherever the figure's own edges allow.
   *
   * @typedef {object} Chip
   * @property {HTMLElement} chip
   * @property {number} x
   * @property {number} y
   * @property {number} w
   * @property {number} h
   * @property {number} cx
   * @property {Span} band
   * @property {Span | null} gap
   * @property {string | null} toId
   */

  /**
   * Which cell a node occupies, as row,column counting from one. The template
   * constrains the shape, so anything reaching here already matched.
   *
   * @param {Element} node
   * @returns {Cell | null}
   *
   * @behaviour canon/figure.canon.html#data-at-decides-the-cell
   */
  function cellOf(node) {
    var at = node.getAttribute("data-at")
    if (!at) return null
    var parts = at.split(",")
    return { row: Number(parts[0]), column: Number(parts[1]) }
  }

  // A box's rectangle in the figure's own coordinates. Measured after the
  // browser has laid the grid out, which is why no position is ever written
  // into the document.
  /**
   * @param {Element} node
   * @param {Origin} origin
   * @returns {Box}
   */
  function boxOf(node, origin) {
    var r = node.getBoundingClientRect()
    return {
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
      midX: r.left + r.width / 2 - origin.left,
      midY: r.top + r.height / 2 - origin.top,
    }
  }

  // How much of the gap between two rows the horizontal runs may use. Lanes
  // live in the top of it and labels in the rest, so a label can never land on
  // another edge's run — which is what put "html" on the line out to "css".
  // Separating the two by band is a rule; nudging either one is not.
  var LANE_BAND = 0.45

  /**
   * The stretch of a gap an edge travels sideways along, which is the part of
   * its lane another edge can run into.
   *
   * @param {Measured} e
   * @returns {{ lo: number, hi: number }}
   *
   * @behaviour canon/figure.canon.html#no-label-covers-another-edge
   */
  function runOf(e) {
    var arrive = e.arriveX === undefined ? e.b.midX : e.arriveX
    return { lo: Math.min(e.a.midX, arrive), hi: Math.max(e.a.midX, arrive) }
  }

  // Present by the time it is asked for, or the passes ran out of order.
  /**
   * @template T
   * @param {T | undefined} value
   * @param {string} what
   * @returns {T}
   */
  function must(value, what) {
    if (value === undefined) throw new Error("a figure was drawn before its " + what + " was worked out")
    return value
  }

  /**
   * Whether two edges crossing one gap may share a lane.
   *
   * Sharing an end is the one reason to want them together: a fork and a merge
   * are the same thing seen from opposite directions, and drawing either as one
   * line says the boxes really do meet. Grouping by source alone never merged,
   * so three edges into one box took three lanes and arrived as three
   * near-parallel lines.
   *
   * Any other pair may share a lane only while their sideways runs keep out of
   * each other's way. Two edges that share no box and cross at the same height
   * draw a junction between relations that have nothing to do with each other,
   * and a reader cannot tell it from a real one.
   *
   * Following the touching all the way through was what put them there. One
   * edge shares a target with a second, the second shares a source with a
   * third, the third shares a target with a fourth. A chain like that sweeps
   * every edge in the gap into one lane, however little its ends have in
   * common.
   *
   * @param {Measured} p
   * @param {Measured} q
   * @returns {boolean}
   *
   * @behaviour canon/figure.canon.html#merge-shares-one-lane
   */
  function canShareLane(p, q) {
    if (p.fromId === q.fromId || p.toId === q.toId) return true
    var a = runOf(p)
    var b = runOf(q)
    return a.lo > b.hi + 0.5 || b.lo > a.hi + 0.5
  }

  /**
   * Whether two nodes sit in one row, read off the cells they declare. A node
   * with no data-at answers no, since it has no row to share.
   *
   * @param {Element} from
   * @param {Element} to
   * @returns {boolean}
   *
   * @behaviour canon/figure.canon.html#peer-runs-level-between-facing-sides
   */
  function sameRow(from, to) {
    var a = cellOf(from)
    var b = cellOf(to)
    return !!(a && b && a.row === b.row)
  }

  /**
   * Puts every edge crossing a gap into a lane, sharing one wherever two may.
   *
   * @param {Measured[]} edges
   *
   * @behaviour canon/figure.canon.html#merge-shares-one-lane
   */
  function assignLanes(edges) {
    /** @type {Record<string, Measured[]>} */
    var channels = {}
    edges.forEach(function (e) {
      // A peer edge crosses no gap, so it has no channel to take a lane in.
      //
      // Nothing visible depends on this yet. Its key would be its own row's
      // bottom and top, which no edge leaving that row for another can match,
      // so it would sit alone in a channel of its own, and routePeer never
      // reads a lane anyway. The guard is here because a lane is a position
      // inside a gap, and this edge has no gap to hold a position in.
      if (e.back || e.peer) return
      var channel = Math.round(e.a.bottom) + ":" + Math.round(e.b.top)
      ;(channels[channel] = channels[channel] || []).push(e)
    })
    Object.keys(channels).forEach(function (channel) {
      var list = channels[channel]
      // Widest first, so a long run takes the lane nearest the source and
      // crosses above the short ones rather than through them.
      var widthOf = /** @param {Measured} e */ function (e) { var r = runOf(e); return r.hi - r.lo }
      list = list.slice().sort(function (p, q) { return widthOf(q) - widthOf(p) })

      // Each edge takes the first lane holding nothing it must stay clear of.
      /** @type {Measured[][]} */
      var lanes = []
      list.forEach(function (e) {
        var free = 0
        while (free < lanes.length && !lanes[free].every(function (other) { return canShareLane(e, other) })) free++
        if (free === lanes.length) lanes.push([])
        lanes[free].push(e)
        e.laneIndex = free
      })

      list.forEach(function (e) {
        var band = (e.b.top - e.a.bottom) * LANE_BAND
        e.lane = e.a.bottom + (band * (must(e.laneIndex, "lane order") + 1)) / (lanes.length + 1)
      })
    })
  }

  /**
   * data-columns names each column in order, so a figure can reserve one for
   * edges: "edge node node node node". A bare count still means that many node
   * columns, which is what every figure written so far says.
   *
   * Node columns are what data-at counts, so reserving an edge column does not
   * renumber anything a figure already declared.
   *
   * @param {Element} graph
   * @returns {string[]}
   *
   * @behaviour canon/figure.canon.html#back-edge-keeps-to-its-column
   */
  function columnKinds(graph) {
    var raw = (graph.getAttribute("data-columns") || "").trim()
    if (!raw) return []
    if (/^\d+$/.test(raw)) {
      /** @type {string[]} */
      var kinds = []
      for (var i = 0; i < Number(raw); i++) kinds.push("node")
      return kinds
    }
    return raw.split(/\s+/)
  }

  /**
   * Where each node column lands once the edge columns are counted in.
   *
   * @param {string[]} kinds
   * @returns {number[]}
   *
   * @behaviour canon/figure.canon.html#back-edge-keeps-to-its-column
   */
  function nodeColumnMap(kinds) {
    /** @type {number[]} */
    var map = []
    kinds.forEach(function (kind, i) {
      if (kind !== "edge") map.push(i + 1)
    })
    return map
  }

  /**
   * The rows an edge travels, so its label can span them and centre itself over
   * the whole run rather than sitting at one end of it.
   *
   * @param {Element} from
   * @param {Element} to
   * @returns {string}
   *
   * @behaviour canon/figure.canon.html#a-lone-label-keeps-its-anchor
   */
  function rowSpan(from, to) {
    var rows = [cellOf(from), cellOf(to)]
      .filter(function (c) { return c !== null })
      .map(function (c) { return c.row })
    if (rows.length < 2) return "auto"
    return Math.min.apply(null, rows) + " / " + (Math.max.apply(null, rows) + 1)
  }

  // How far apart two lines landing on the same box arrive, and the least room
  // to leave either side of them.
  var ARRIVAL_SPACING = 30
  var ARRIVAL_MARGIN = 14

  /**
   * Edges reaching one box land at points of their own along its top edge,
   * rather than all on its middle.
   *
   * Sharing a lane is right and stays: three edges into one box that each took
   * a lane of their own arrived as three near-parallel lines. Sharing the drop
   * as well is what went wrong. The lines became one before they landed, so a
   * reader could not see how many there were, and every label anchored to that
   * one drop and stacked on top of itself.
   *
   * Sorted by where each line comes from, so spreading them out never makes two
   * lines cross on the way in.
   * The edges landing on each box, which are the ones whose labels meet.
   *
   * @param {Measured[]} edges
   * @returns {Measured[][]}
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   */
  function arrivalGroups(edges) {
    /** @type {Record<string, Measured[]>} */
    var byTarget = {}
    edges.forEach(function (e) {
      if (e.back || e.peer || !e.toId) return
      ;(byTarget[e.toId] = byTarget[e.toId] || []).push(e)
    })
    return Object.keys(byTarget)
      .map(function (id) { return byTarget[id] })
      .filter(function (group) { return group.length > 1 })
  }

  /**
   * Spreads the landings on one box apart, so two labels have room to sit side by side.
   *
   * @param {Measured[]} edges
   * @param {number} spacing
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   */
  function spreadArrivals(edges, spacing) {
    arrivalGroups(edges).forEach(function (group) {
      group.sort(function (p, q) { return p.a.midX - q.a.midX })
      var box = group[0].b
      var room = Math.max(box.right - box.left - ARRIVAL_MARGIN * 2, 0)
      var span = Math.min(room, (group.length - 1) * spacing)
      var start = (box.left + box.right) / 2 - span / 2
      group.forEach(function (e, i) {
        e.arriveX = start + (span * i) / (group.length - 1)
      })
    })
  }

  /** @param {Measured} e */
  function routeForward(e) {
    var arrive = e.arriveX === undefined ? e.b.midX : e.arriveX
    var lane = must(e.lane, "lane")
    e.d = "M" + e.a.midX + "," + e.a.bottom + " L" + e.a.midX + "," + lane +
          " L" + arrive + "," + lane + " L" + arrive + "," + e.b.top
    // On the drop into its own target, which is a segment this edge does not
    // share, now that each edge lands at a point of its own.
    e.labelAt = { x: arrive, y: (lane + e.b.top) / 2 }
  }

  /**
   * A peer edge joins two boxes in one row, so it runs straight across the gap
   * between their facing sides. No elbow and no lane: both boxes share a row, a
   * row is as tall as its tallest box, and the line between their middles is
   * already level.
   *
   * Its label wants the space above the row rather than the line itself. Two
   * neighbours leave only the column gap between them, around twenty pixels,
   * and a chip is wider than that: on the line it covered the whole edge
   * including the arrowhead, so the figure stopped saying which way the
   * relation ran. The band decides how far above it lands.
   *
   * @param {Measured} e
   *
   * @behaviour canon/figure.canon.html#peer-label-clears-its-own-line
   * @behaviour canon/figure.canon.html#peer-across-an-empty-column
   * @behaviour canon/figure.canon.html#peer-running-leftwards
   * @behaviour canon/figure.canon.html#peer-runs-level-between-facing-sides
   */
  function routePeer(e) {
    var rightwards = e.b.midX > e.a.midX
    var start = rightwards ? e.a.right : e.a.left
    var end = rightwards ? e.b.left : e.b.right
    var y = (e.a.midY + e.b.midY) / 2
    e.d = "M" + start + "," + y + " L" + end + "," + y
    e.labelAt = { x: (start + end) / 2, y: e.a.top }
  }

  /**
   * A back edge runs down the middle of its own column, and its label already
   * sits there as a grid item, so the wire follows the label rather than the
   * label chasing the wire. The grid sizes the column to whatever the label
   * needs, which is why no length of text can push one outside the figure.
   *
   * @param {Measured} e
   *
   * @behaviour canon/figure.canon.html#no-label-leaves-the-figure
   * @behaviour canon/figure.canon.html#back-edge-keeps-to-its-column
   */
  function routeBack(e) {
    var x = must(e.marker, "gutter label").midX
    e.d = "M" + e.a.left + "," + e.a.midY + " L" + x + "," + e.a.midY +
          " L" + x + "," + e.b.midY + " L" + e.b.left + "," + e.b.midY
    e.labelAt = null
  }

  var SVG = "http://www.w3.org/2000/svg"

  // What a figure carries from one draw to the next: the landing spacing its
  // labels turned out to need, and the row gap it last asked for. Both come
  // from measuring, so the pass that measures them cannot also use them, and a
  // redraw has to find them again.
  //
  // In a map beside the element rather than as properties on it. An element is
  // the document's, and hanging private state off one puts this code's
  // workings somewhere a reader of the page can trip over.
  /** @type {WeakMap<Element, { arrivalSpacing?: number, askedGap?: number }>} */
  var memory = new WeakMap()

  /**
   * @param {Element} graph
   * @returns {{ arrivalSpacing?: number, askedGap?: number }}
   */
  function remembered(graph) {
    var found = memory.get(graph)
    if (!found) {
      found = {}
      memory.set(graph, found)
    }
    return found
  }

  /** @param {HTMLElement} graph */
  function draw(graph) {
    var old = graph.querySelector("svg.figure-wires")
    if (old) old.remove()
    Array.prototype.forEach.call(graph.querySelectorAll(".figure-label"), function (el) { el.remove() })

    var svg = document.createElementNS(SVG, "svg")
    svg.setAttribute("class", "figure-wires")

    var marker = document.createElementNS(SVG, "marker")
    marker.setAttribute("id", "figure-arrow-" + (graph.id || "figure"))
    marker.setAttribute("viewBox", "0 0 8 8")
    marker.setAttribute("refX", "7")
    marker.setAttribute("refY", "4")
    marker.setAttribute("markerWidth", "6")
    marker.setAttribute("markerHeight", "6")
    marker.setAttribute("orient", "auto")
    var head = document.createElementNS(SVG, "path")
    head.setAttribute("d", "M0,0 L8,4 L0,8 z")
    head.setAttribute("fill", "currentColor")
    marker.appendChild(head)
    var defs = document.createElementNS(SVG, "defs")
    defs.appendChild(marker)
    svg.appendChild(defs)

    // Collect every edge with the boxes it joins, before routing any of them.
    // Routing one at a time is what made lanes an offset per source rather than
    // an allocation per channel, and an offset cannot know what else is in the
    // gap it is crossing.
    /** @type {Edge[]} */
    var collected = []
    Array.prototype.forEach.call(graph.querySelectorAll("figure-edge"), function (/** @type {Element} */ edge) {
      var from = graph.querySelector('figure-node[id="' + edge.getAttribute("from") + '"]')
      var to = graph.querySelector('figure-node[id="' + edge.getAttribute("to") + '"]')
      // The audit catches a name that resolves to nothing, so skipping here
      // only covers a page opened without validation having run.
      if (!from || !to) return
      collected.push({
        fromId: edge.getAttribute("from"),
        toId: edge.getAttribute("to"),
        fromNode: from,
        toNode: to,
        // Read, not measured. Comparing box positions would let a
        // rearrangement restyle an edge with nothing in the document changing,
        // and an inference from measured state always has a wrong answer
        // available to it. The audit checks the declaration against the rows,
        // so a lie fails the build rather than rendering.
        back: edge.hasAttribute("data-back"),
        // Two boxes in one row, so the edge travels sideways and never crosses
        // a gap between rows. Worked out from data-at rather than declared,
        // which is not the inference data-back replaced: that one compared
        // measured boxes, and this reads two numbers the figure wrote down. A
        // rearrangement that moves a node to another row changes the document,
        // so nothing can shift underneath this without the file changing too.
        peer: sameRow(from, to),
        text: (edge.textContent || "").trim(),
      })
    })

    // A back edge's label goes into an edge column first, as an ordinary grid
    // item, and the grid then sizes that column to hold it. Doing it the other
    // way round made a label's own width this code's problem, and a longer one
    // always found the edge of the figure.
    var kinds = columnKinds(graph)
    /** @type {number[]} */
    var edgeColumns = []
    kinds.forEach(function (kind, i) { if (kind === "edge") edgeColumns.push(i + 1) })
    var backSeen = 0
    collected.forEach(function (e) {
      if (!e.back) return
      var column = edgeColumns[backSeen % Math.max(edgeColumns.length, 1)] || 1
      backSeen++
      var slot = document.createElement("div")
      slot.className = "figure-label"
      slot.setAttribute("data-in-column", "")
      slot.setAttribute("data-kind", "back")
      slot.textContent = e.text
      if (!e.text) slot.setAttribute("data-empty", "")
      slot.style.gridColumn = String(column)
      slot.style.gridRow = rowSpan(e.fromNode, e.toNode)
      graph.appendChild(slot)
      e.slot = slot
    })

    // Everything gets measured here, after the slots are in and never before.
    // An empty edge column has no width, so putting a label in one widens it
    // and pushes every node along. Boxes read before that are short by exactly
    // that column, which is what drew the wires beside the boxes rather than
    // into them.
    // The padding box, not the border box. The overlay is inset:0 inside the
    // figure and a chip is positioned the same way, so both land against the
    // padding box, while getBoundingClientRect answers for the border box.
    // Measuring against the wrong one drew every wire and every label one
    // border-width away from the boxes it had just measured.
    var frame = graph.getBoundingClientRect()
    var borders = getComputedStyle(graph)
    var placed = {
      left: frame.left + parseFloat(borders.borderLeftWidth || "0"),
      top: frame.top + parseFloat(borders.borderTopWidth || "0"),
    }
    collected.forEach(function (e) {
      e.a = boxOf(e.fromNode, placed)
      e.b = boxOf(e.toNode, placed)
      if (e.slot) e.marker = boxOf(e.slot, placed)
    })

    // The bottom of the nearest row above a given line, or the top of the
    // figure when nothing is above it. A peer edge's label goes in that space,
    // since its own row is solid boxes from side to side.
    /**
     * @param {number} top
     * @returns {number}
     */
    function rowAbove(top) {
      var found = 0
      Array.prototype.forEach.call(graph.querySelectorAll("figure-node"), function (/** @type {Element} */ node) {
        var bottom = boxOf(node, placed).bottom
        if (bottom <= top + 0.5) found = Math.max(found, bottom)
      })
      return found
    }

    // Measured, from here on. The loop above gave every edge both its boxes,
    // which is the one thing the passes below all assume.
    var edges = /** @type {Measured[]} */ (collected)

    // Arrivals first. A lane depends on where each run begins and ends, and
    // spreading the landings is what decides where a run ends.
    spreadArrivals(edges, remembered(graph).arrivalSpacing || ARRIVAL_SPACING)
    assignLanes(edges)
    edges.forEach(function (e) {
      if (e.back) routeBack(e)
      else if (e.peer) routePeer(e)
      else routeForward(e)
      // Where this edge's label may live: the gap its own line crosses, and
      // never a box. A forward edge crosses the gap between two rows. A peer
      // edge crosses no gap at all, so its label goes in the space above its
      // row, which is the nearest thing it has to one.
      // Below its own lane, not anywhere in the gap. A label sitting level with
      // the horizontal run reads as naming that run, and the run belongs to
      // every edge in the group rather than to this one. The drop underneath is
      // this edge's alone, now that each edge lands at a point of its own.
      e.labelBand = e.back ? null
        : e.peer ? { top: rowAbove(e.a.top), bottom: e.a.top }
        : { top: must(e.lane, "lane"), bottom: e.b.top }
      // The whole gap the edge crosses, which is wider than the band and is
      // what decides whether two labels have to fit past each other. Two edges
      // into one box can take different lanes when a third crossing the gap
      // keeps them apart, and their labels still share the space.
      e.labelGap = e.back ? null
        : e.peer ? e.labelBand
        : { top: e.a.bottom, bottom: e.b.top }
    })

    // Every wire first, before any label. SVG paints in document order, so a
    // label drawn during its own edge's turn would end up under the wires of
    // every edge after it.
    edges.forEach(function (e) {
      var path = document.createElementNS(SVG, "path")
      path.setAttribute("class", "wire")
      path.setAttribute("d", must(e.d, "path"))
      path.setAttribute("marker-end", "url(#" + marker.getAttribute("id") + ")")
      if (e.back) path.setAttribute("data-kind", "back")
      else if (e.peer) path.setAttribute("data-kind", "peer")
      svg.appendChild(path)
    })

    var labels = edges
      .filter(function (e) { return e.text })
      .map(function (e) {
        return {
          text: e.text, at: e.labelAt, band: e.labelBand, gap: e.labelGap,
          back: e.back, peer: e.peer, toId: e.toId,
        }
      })

    graph.insertBefore(svg, graph.firstChild)

    // Labels are HTML, not SVG. SVG text carries no background, so a chip
    // behind one meant a rect sized by getBBox. That answers zero while the SVG
    // is still detached, so every rect came out twelve by six in the corner and
    // no label was ever masked.
    //
    // An absolutely positioned element needs no measuring at all. The graph is
    // already a positioned ancestor, a half-size translate centres the chip on
    // its anchor whatever width the text turns out to be, and the border and
    // the rounding are ordinary CSS rather than attributes computed here.
    // A back edge is the one with nowhere to float: its label is already a grid
    // item in an edge column, so it has no anchor and no band, and it is not a
    // chip at all.
    /** @type {Chip[]} */
    var chips = []
    labels.forEach(function (item) {
      var at = item.at
      var band = item.band
      if (!at || !band) return
      var chip = document.createElement("div")
      chip.className = "figure-label"
      chip.style.left = at.x + "px"
      chip.style.top = at.y + "px"
      // The same kind the wire carries, so the stylesheet can give a label the
      // colour of the line it names rather than a border of its own.
      if (item.back) chip.setAttribute("data-kind", "back")
      else if (item.peer) chip.setAttribute("data-kind", "peer")
      chip.textContent = item.text
      graph.appendChild(chip)
      var size = chip.getBoundingClientRect()
      chips.push({
        chip: chip, x: at.x, y: at.y, cx: at.x,
        w: size.width, h: size.height,
        band: band, gap: item.gap || null, toId: item.toId,
      })
    })

    // A gap too shallow for the labels crossing it grows until they fit, and
    // the whole figure redraws against the new layout.
    //
    // This is the rule an edge column already follows: a back edge's label is a
    // grid item, and the grid sizes that column to hold it, so no length of
    // text is this code's problem. A row gap is the same question turned on its
    // side. Cramming three labels into a fixed gap made them share one label's
    // worth of height and overlap; asking the row for more room does not.
    //
    // Only ever larger, so the second pass asks for what it already has and
    // stops. CSS gives one row-gap to every row, so a figure is as open as its
    // busiest gap needs.
    // Landings far enough apart that no label reaches its neighbour's drop.
    //
    // A chip is opaque, and masking the line it names is the point: it knocks a
    // hole rather than printing over it. Masking somebody else's is not, and a
    // covered drop reads as an edge that stops in mid-air.
    //
    // A chip is centred on its own landing, so half of it is what reaches
    // towards the next one. Widths only exist once the chips do, so this asks
    // for the room it turns out to need and the figure draws again.
    var spacing = remembered(graph).arrivalSpacing || ARRIVAL_SPACING
    var widest = neededArrivalSpacing(chips, edges)
    if (widest > spacing + 0.5) {
      remembered(graph).arrivalSpacing = widest
      requestAnimationFrame(function () { draw(graph) })
      return
    }

    var present = parseFloat(getComputedStyle(graph).rowGap) || 0
    var wanted = neededRowGap(chips, present)
    if (wanted > present + 0.5 && remembered(graph).askedGap !== wanted) {
      // Asked for in a later frame, and never here. A redraw often comes from
      // the ResizeObserver, and changing a style inside that callback resizes
      // the thing being observed while it is still being delivered, which the
      // browser reports as a loop with notifications left undelivered.
      //
      // Remembering what was asked for stops a figure that cannot be satisfied
      // from asking again every frame.
      remembered(graph).askedGap = wanted
      requestAnimationFrame(function () { graph.style.rowGap = wanted + "px" })
      return
    }

    placeLabels(chips, { width: graph.clientWidth, height: graph.clientHeight })
  }

  // A ceiling on how far a gap will open, so a figure nobody can satisfy stops
  // growing instead of running away.
  var MAX_ROW_GAP = 320

  /**
   * Half the widest label landing on a box, plus a little air. Half, because a
   * chip is centred on its own landing and only half of it reaches towards the
   * next. A box narrower than that caps the spread on its own, in
   * spreadArrivals, so this asks rather than demands.
   *
   * @param {Chip[]} chips
   * @param {Measured[]} edges
   * @returns {number}
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   */
  function neededArrivalSpacing(chips, edges) {
    /** @type {Record<string, number>} */
    var widthByTarget = {}
    chips.forEach(function (entry) {
      if (!entry.toId) return
      widthByTarget[entry.toId] = Math.max(widthByTarget[entry.toId] || 0, entry.w)
    })
    var needed = ARRIVAL_SPACING
    arrivalGroups(edges).forEach(function (group) {
      var target = group[0].toId
      var width = target ? widthByTarget[target] : 0
      if (width) needed = Math.max(needed, width / 2 + 6)
    })
    return needed
  }

  /**
   * How much deeper the busiest gap needs to be, answered as a whole row-gap.
   *
   * A band's height depends on the gap it sits in, and the lane above it moves
   * as the gap moves, so this asks for the current gap plus whatever the worst
   * cluster is short by. The next pass measures the new layout and asks again,
   * which settles after a pass or two rather than solving it in one.
   *
   * Every label is measured first, because a chip is sized by its own text,
   * then grouped the way placeLabels groups them: labels that overlap left to
   * right are the ones that have to stack.
   *
   * @param {Chip[]} chips
   * @param {number} present
   * @returns {number}
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   */
  function neededRowGap(chips, present) {
    var shortfall = 0
    // Grouped by the gap an edge crosses rather than by the lane it took. Two
    // edges into one box can end up in different lanes, when a third crossing
    // the gap keeps them apart, and their labels still have to fit past each
    // other. Measuring per lane declared that pair roomy and left them stacked.
    byGap(chips.filter(function (entry) { return entry.gap })).forEach(function (group) {
      cluster(group).forEach(function (run) {
        var tallest = Math.max.apply(null, run.map(function (entry) { return entry.h }))
        var wants = run.length * (tallest + LABEL_GUTTER) + LABEL_GUTTER
        // The tightest band in the run, since that is the one with no room.
        var has = Math.min.apply(null, run.map(function (/** @type {Chip} */ entry) {
          return entry.band.bottom - entry.band.top
        }))
        shortfall = Math.max(shortfall, wants - has)
      })
    })
    return Math.min(present + shortfall, MAX_ROW_GAP)
  }

  // Space between two stacked labels, and from a label to the edge of its gap.
  var LABEL_GUTTER = 3

  /**
   * An anchor says where a label wants to sit, not where it may. Three rules
   * decide where it ends up, and all three come from figures that broke:
   *
   * It stays inside the figure, because a long label near either side hung out
   * past the border. It stays inside the gap its own edge crosses, because a
   * gap holds no boxes at any width, so a label there can never cover a node.
   * And it moves clear of the labels already placed, because a chip is opaque
   * and the second one drawn hid the first, leaving a figure that showed one
   * relation while claiming two.
   *
   * Measuring is the only way to do any of it. A chip is sized by its own text
   * and nothing here knows how wide a word renders.
   *
   * @param {Chip[]} chips
   * @param {{ width: number, height: number }} inner
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   * @behaviour canon/figure.canon.html#no-label-covers-a-node
   * @behaviour canon/figure.canon.html#no-label-leaves-the-figure
   */
  function placeLabels(chips, inner) {
    chips.forEach(function (entry) {
      // Inside the figure. A long label near either side hung out past the
      // border, because a chip is centred on its anchor and half of it can
      // reach further than the anchor does.
      entry.cx = Math.min(Math.max(entry.x, entry.w / 2), Math.max(inner.width - entry.w / 2, entry.w / 2))
      entry.chip.style.left = entry.cx + "px"
    })

    // Grouped by the gap an edge crosses, not by the lane it took inside that
    // gap. Two edges into one box can end up in different lanes, when a third
    // edge crossing the gap keeps them apart, and their labels still have to
    // fit past each other. Grouping by lane declared such a pair unrelated and
    // left one sitting on the other.
    byGap(chips.filter(function (entry) { return entry.gap })).forEach(function (group) {
      cluster(group).forEach(function (run) { pack(run) })
    })
  }

  /**
   * Stack a run of labels down the space they share, each inside its own band.
   *
   * A lone label keeps the height its edge asked for. Several cannot: letting
   * the first take the height it wanted leaves it in the middle of the room,
   * and no place left is far enough from it, even when the two would have fitted
   * at either end. So a run starts at the top of what it may use and comes down
   * from there.
   *
   * @param {Chip[]} run
   *
   * @behaviour canon/figure.canon.html#a-lone-label-keeps-its-anchor
   */
  function pack(run) {
    var ordered = run.slice().sort(function (p, q) { return p.y - q.y })
    /** @type {number | null} */
    var below = null
    ordered.forEach(function (entry) {
      var half = entry.h / 2
      var lowest = entry.band.top + half + LABEL_GUTTER
      var highest = entry.band.bottom - half - LABEL_GUTTER
      // A band too shallow for the label has no good answer. It takes the
      // middle and crowds a neighbour rather than stepping out onto a box.
      if (highest < lowest) {
        entry.chip.style.top = (entry.band.top + entry.band.bottom) / 2 + "px"
        return
      }
      var y = ordered.length === 1 ? Math.min(Math.max(entry.y, lowest), highest) : lowest
      if (below !== null) y = Math.max(y, below + LABEL_GUTTER + half)
      y = Math.min(y, highest)
      entry.chip.style.top = y + "px"
      below = y + half
    })
  }

  /**
   * Groups labels by the gap their edge crosses, since that is the space they share.
   *
   * @param {Chip[]} chips
   * @returns {Chip[][]}
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   */
  function byGap(chips) {
    /** @type {Record<string, Chip[]>} */
    var groups = {}
    chips.forEach(function (entry) {
      var gap = entry.gap
      if (!gap) return
      var key = Math.round(gap.top) + ":" + Math.round(gap.bottom)
      ;(groups[key] = groups[key] || []).push(entry)
    })
    return Object.keys(groups).map(function (key) { return groups[key] })
  }

  /**
   * Runs of labels that overlap left to right, found by sweeping across.
   *
   * @param {Chip[]} group
   * @returns {Chip[][]}
   *
   * @behaviour canon/figure.canon.html#labels-into-one-box-do-not-overlap
   */
  function cluster(group) {
    var sorted = group.slice().sort(function (p, q) { return (p.cx - p.w / 2) - (q.cx - q.w / 2) })
    /** @type {Chip[][]} */
    var runs = []
    /** @type {Chip[] | null} */
    var current = null
    var reach = 0
    sorted.forEach(function (entry) {
      var left = entry.cx - entry.w / 2
      if (!current || left >= reach) {
        current = []
        runs.push(current)
        reach = 0
      }
      current.push(entry)
      reach = Math.max(reach, entry.cx + entry.w / 2)
    })
    return runs
  }

  var FigureGraph = function () {
    return Reflect.construct(HTMLElement, [], FigureGraph)
  }
  FigureGraph.prototype = Object.create(HTMLElement.prototype)
  FigureGraph.prototype.constructor = FigureGraph
  Object.setPrototypeOf(FigureGraph, HTMLElement)

  /**
   * Lays every node into the cell it declares, and sizes the columns around them.
   *
   * @param {HTMLElement} graph
   *
   * @behaviour canon/figure.canon.html#data-at-decides-the-cell
   */
  function place(graph) {
    // A node column shares the width evenly, with minmax(0, …) for the reason
    // the stylesheet gives on grid-auto-columns. An edge column takes only what
    // the label inside it needs, which is what stops a long label reaching past
    // the figure however wide the text turns out to be.
    var kinds = columnKinds(graph)
    if (kinds.length) {
      graph.style.gridTemplateColumns = kinds
        .map(function (kind) { return kind === "edge" ? "auto" : "minmax(0, 1fr)" })
        .join(" ")
    }
    var nodeColumns = nodeColumnMap(kinds)

    Array.prototype.forEach.call(graph.querySelectorAll("figure-node"), function (node) {
      var cell = cellOf(node)
      if (!cell) return
      node.style.gridRow = String(cell.row)
      // data-at counts node columns, so an edge column reserved beside them
      // never renumbers what a figure already declared.
      node.style.gridColumn = String(nodeColumns[cell.column - 1] || cell.column)
    })

    // Drawn after layout, redrawn whenever the box sizes change. A figure that
    // reflows on a resize or a font swap gets new connectors from the new
    // positions, because nothing here remembers the old ones.
    requestAnimationFrame(function () { draw(graph) })
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function () { draw(graph) }).observe(graph)
    }
  }

  FigureGraph.prototype.connectedCallback = function () {
    var graph = /** @type {HTMLElement} */ (/** @type {unknown} */ (this))
    // A figure upgrades the moment the parser reaches its start tag, and its own
    // nodes do not exist yet at that point. Placing them then finds nothing, so
    // every node falls into grid auto-placement and the cells a figure declared
    // do nothing at all.
    //
    // Only a script loaded at the end of the body avoided this, because by then
    // the parser had already built every figure. Waiting for the document to
    // finish costs one event and stops the script's position in the page from
    // deciding whether data-at means anything.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { place(graph) })
    } else {
      place(graph)
    }
  }

  // Cast because the constructor is hand-rolled rather than a class. It has to
  // be: a class compiles to syntax older browsers reject, and this file ships
  // as written. Reflect.construct gives the same prototype chain, and the
  // registry only ever sees a real element.
  if (!customElements.get("figure-graph")) {
    customElements.define("figure-graph", /** @type {CustomElementConstructor} */ (/** @type {unknown} */ (FigureGraph)))
  }
})()
