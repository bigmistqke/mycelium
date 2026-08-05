// Behaviour for the figure-* vocabulary. A classic script on purpose, and not a
// module: a document here opens over file://, module scripts are CORS-checked,
// and that origin cannot satisfy the check. The spec that deleted runtime.js
// describes the same constraint.
//
// Reading this as a workaround gets it backwards. customElements is a global
// registry, so registering an element is a global side effect however the
// script arrives, and there is no module-scoped version of that to give up.
;(function () {
  "use strict"

  // Which cell a node occupies, as row,column counting from one. The template
  // constrains the shape, so anything reaching here already matched.
  function cellOf(node) {
    var at = node.getAttribute("data-at")
    if (!at) return null
    var parts = at.split(",")
    return { row: Number(parts[0]), column: Number(parts[1]) }
  }

  // A box's rectangle in the figure's own coordinates. Measured after the
  // browser has laid the grid out, which is why no position is ever written
  // into the document.
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

  // Every edge leaving one box for one row shares a lane, which is what makes
  // them read as a fork. Their trunks then coincide at the source and their
  // horizontals merge into one bus, instead of each edge dropping to a height
  // of its own and splitting the same junction into three near-parallel lines.
  //
  // Forks crossing the same gap still need separate lanes, and the widest takes
  // the one nearest the source, so a long run crosses above the short ones
  // rather than through them.
  function assignLanes(edges) {
    var channels = {}
    edges.forEach(function (e) {
      if (e.back) return
      var channel = Math.round(e.a.bottom) + ":" + Math.round(e.b.top)
      var fork = channel + ":" + e.fromId
      channels[channel] = channels[channel] || {}
      ;(channels[channel][fork] = channels[channel][fork] || []).push(e)
    })
    Object.keys(channels).forEach(function (channel) {
      var forks = Object.keys(channels[channel]).map(function (key) { return channels[channel][key] })
      var widthOf = function (fork) {
        return Math.max.apply(null, fork.map(function (e) { return Math.abs(e.b.midX - e.a.midX) }))
      }
      forks.sort(function (p, q) { return widthOf(q) - widthOf(p) })
      forks.forEach(function (fork, i) {
        fork.forEach(function (e) {
          var band = (e.b.top - e.a.bottom) * LANE_BAND
          e.lane = e.a.bottom + (band * (i + 1)) / (forks.length + 1)
        })
      })
    })
  }

  // Back edges run in a gutter down the left of the figure, outside every
  // column. Sending them out the right of their source ran the wire through
  // whatever sat in the next column along, so "re-enters" was not overlapping
  // the css box by bad luck — its wire crossed that box. The stylesheet
  // reserves the gutter as padding, so nothing else can be there.
  var GUTTER = 22
  var GUTTER_STEP = 13

  function routeForward(e) {
    e.d = "M" + e.a.midX + "," + e.a.bottom + " L" + e.a.midX + "," + e.lane +
          " L" + e.b.midX + "," + e.lane + " L" + e.b.midX + "," + e.b.top
    // Below every lane, on the drop into its own target. Two labels cannot
    // meet there either, since each target owns its own column.
    e.labelAt = { x: e.b.midX, y: (e.lane + e.b.top) / 2 }
  }

  function routeBack(e, index) {
    var x = GUTTER + index * GUTTER_STEP
    e.d = "M" + e.a.left + "," + e.a.midY + " L" + x + "," + e.a.midY +
          " L" + x + "," + e.b.midY + " L" + e.b.left + "," + e.b.midY
    // Right of the wire rather than across it. The gutter sits at the figure's
    // edge, so a centred chip hangs half of itself outside the border, and the
    // inside is the only side there is. A chip beside a long vertical still
    // reads as its label; the earlier version that looked detached sat beside a
    // short segment crowded by boxes.
    e.labelAt = { x: x, y: (e.a.midY + e.b.midY) / 2, side: "right" }
  }

  var SVG = "http://www.w3.org/2000/svg"

  function draw(graph) {
    var origin = graph.getBoundingClientRect()
    var old = graph.querySelector("svg.figure-wires")
    if (old) old.remove()
    Array.prototype.forEach.call(graph.querySelectorAll(".figure-label"), function (el) { el.remove() })

    var svg = document.createElementNS(SVG, "svg")
    svg.setAttribute("class", "figure-wires")

    var marker = document.createElementNS(SVG, "marker")
    marker.setAttribute("id", "figure-arrow-" + (graph.id || Math.abs(origin.width | 0)))
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
    var edges = []
    Array.prototype.forEach.call(graph.querySelectorAll("figure-edge"), function (edge) {
      var from = graph.querySelector('figure-node[id="' + edge.getAttribute("from") + '"]')
      var to = graph.querySelector('figure-node[id="' + edge.getAttribute("to") + '"]')
      // The audit catches a name that resolves to nothing, so skipping here
      // only covers a page opened without validation having run.
      if (!from || !to) return
      edges.push({
        fromId: edge.getAttribute("from"),
        a: boxOf(from, origin),
        b: boxOf(to, origin),
        // Read, not measured. Comparing box positions would let a
        // rearrangement restyle an edge with nothing in the document changing,
        // and an inference from measured state always has a wrong answer
        // available to it. The audit checks the declaration against the rows,
        // so a lie fails the build rather than rendering.
        back: edge.hasAttribute("data-back"),
        text: edge.textContent.trim(),
      })
    })

    assignLanes(edges)
    var backSeen = 0
    edges.forEach(function (e) {
      if (e.back) routeBack(e, backSeen++)
      else routeForward(e)
    })

    // Every wire first, before any label. SVG paints in document order, so a
    // label drawn during its own edge's turn would end up under the wires of
    // every edge after it.
    edges.forEach(function (e) {
      var path = document.createElementNS(SVG, "path")
      path.setAttribute("class", "wire")
      path.setAttribute("d", e.d)
      path.setAttribute("marker-end", "url(#" + marker.getAttribute("id") + ")")
      if (e.back) path.setAttribute("data-kind", "back")
      svg.appendChild(path)
    })

    var labels = edges
      .filter(function (e) { return e.text })
      .map(function (e) { return { text: e.text, at: e.labelAt, back: e.back } })

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
    labels.forEach(function (item) {
      var chip = document.createElement("div")
      chip.className = "figure-label"
      chip.style.left = item.at.x + "px"
      chip.style.top = item.at.y + "px"
      // The same kind the wire carries, so the stylesheet can give a label the
      // colour of the line it names rather than a border of its own.
      if (item.back) chip.setAttribute("data-kind", "back")
      if (item.at.side) chip.setAttribute("data-side", item.at.side)
      chip.textContent = item.text
      graph.appendChild(chip)
    })
  }

  var FigureGraph = function () {
    return Reflect.construct(HTMLElement, [], FigureGraph)
  }
  FigureGraph.prototype = Object.create(HTMLElement.prototype)
  FigureGraph.prototype.constructor = FigureGraph
  Object.setPrototypeOf(FigureGraph, HTMLElement)

  FigureGraph.prototype.connectedCallback = function () {
    var graph = this
    var columns = graph.getAttribute("data-columns")
    // minmax(0, …), for the reason the stylesheet gives on grid-auto-columns.
    if (columns) graph.style.gridTemplateColumns = "repeat(" + columns + ", minmax(0, 1fr))"

    Array.prototype.forEach.call(graph.querySelectorAll("figure-node"), function (node) {
      var cell = cellOf(node)
      if (!cell) return
      node.style.gridRow = String(cell.row)
      node.style.gridColumn = String(cell.column)
    })

    // Drawn after layout, redrawn whenever the box sizes change. A figure that
    // reflows on a resize or a font swap gets new connectors from the new
    // positions, because nothing here remembers the old ones.
    requestAnimationFrame(function () { draw(graph) })
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(function () { draw(graph) }).observe(graph)
    }
  }

  if (!customElements.get("figure-graph")) customElements.define("figure-graph", FigureGraph)
})()
