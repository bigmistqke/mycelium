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

  // Edges crossing one gap are grouped by which of them touch, and a group
  // shares a lane. Two edges touch when they share either end, so a fork and a
  // merge are the same thing seen from opposite directions.
  //
  // Grouping by source alone forked correctly and never merged: three edges
  // into one box have three different sources, so they took three lanes and
  // arrived as three near-parallel lines instead of one.
  //
  // Groups crossing the same gap still need separate lanes, and the widest
  // takes the one nearest the source, so a long run crosses above the short
  // ones rather than through them.
  function componentsOf(list) {
    var parent = list.map(function (_, i) { return i })
    function find(i) {
      while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i] }
      return i
    }
    for (var i = 0; i < list.length; i++) {
      for (var j = i + 1; j < list.length; j++) {
        if (list[i].fromId !== list[j].fromId && list[i].toId !== list[j].toId) continue
        var a = find(i)
        var b = find(j)
        if (a !== b) parent[a] = b
      }
    }
    var groups = {}
    list.forEach(function (e, k) {
      var root = find(k)
      ;(groups[root] = groups[root] || []).push(e)
    })
    return Object.keys(groups).map(function (key) { return groups[key] })
  }

  function assignLanes(edges) {
    var channels = {}
    edges.forEach(function (e) {
      if (e.back) return
      var channel = Math.round(e.a.bottom) + ":" + Math.round(e.b.top)
      ;(channels[channel] = channels[channel] || []).push(e)
    })
    Object.keys(channels).forEach(function (channel) {
      var groups = componentsOf(channels[channel])
      var widthOf = function (group) {
        return Math.max.apply(null, group.map(function (e) { return Math.abs(e.b.midX - e.a.midX) }))
      }
      groups.sort(function (p, q) { return widthOf(q) - widthOf(p) })
      groups.forEach(function (group, i) {
        group.forEach(function (e) {
          var band = (e.b.top - e.a.bottom) * LANE_BAND
          e.lane = e.a.bottom + (band * (i + 1)) / (groups.length + 1)
        })
      })
    })
  }

  // data-columns names each column in order, so a figure can reserve one for
  // edges: "edge node node node node". A bare count still means that many node
  // columns, which is what every figure written so far says.
  //
  // Node columns are what data-at counts, so reserving an edge column does not
  // renumber anything a figure already declared.
  function columnKinds(graph) {
    var raw = (graph.getAttribute("data-columns") || "").trim()
    if (!raw) return []
    if (/^\d+$/.test(raw)) {
      var kinds = []
      for (var i = 0; i < Number(raw); i++) kinds.push("node")
      return kinds
    }
    return raw.split(/\s+/)
  }

  // Where each node column lands once the edge columns are counted in.
  function nodeColumnMap(kinds) {
    var map = []
    kinds.forEach(function (kind, i) {
      if (kind !== "edge") map.push(i + 1)
    })
    return map
  }

  // The rows an edge travels, so its label can span them and centre itself over
  // the whole run rather than sitting at one end of it.
  function rowSpan(from, to) {
    var rows = [cellOf(from), cellOf(to)].filter(Boolean).map(function (c) { return c.row })
    if (rows.length < 2) return "auto"
    return Math.min.apply(null, rows) + " / " + (Math.max.apply(null, rows) + 1)
  }

  function routeForward(e) {
    e.d = "M" + e.a.midX + "," + e.a.bottom + " L" + e.a.midX + "," + e.lane +
          " L" + e.b.midX + "," + e.lane + " L" + e.b.midX + "," + e.b.top
    // Below every lane, on the drop into its own target. Two labels cannot
    // meet there either, since each target owns its own column.
    e.labelAt = { x: e.b.midX, y: (e.lane + e.b.top) / 2 }
  }

  // A back edge runs down the middle of its own column, and its label already
  // sits there as a grid item, so the wire follows the label rather than the
  // label chasing the wire. The grid sizes the column to whatever the label
  // needs, which is why no length of text can push one outside the figure.
  function routeBack(e) {
    var x = e.marker.midX
    e.d = "M" + e.a.left + "," + e.a.midY + " L" + x + "," + e.a.midY +
          " L" + x + "," + e.b.midY + " L" + e.b.left + "," + e.b.midY
    e.labelAt = null
  }

  var SVG = "http://www.w3.org/2000/svg"

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
    var edges = []
    Array.prototype.forEach.call(graph.querySelectorAll("figure-edge"), function (edge) {
      var from = graph.querySelector('figure-node[id="' + edge.getAttribute("from") + '"]')
      var to = graph.querySelector('figure-node[id="' + edge.getAttribute("to") + '"]')
      // The audit catches a name that resolves to nothing, so skipping here
      // only covers a page opened without validation having run.
      if (!from || !to) return
      edges.push({
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
        text: edge.textContent.trim(),
      })
    })

    // A back edge's label goes into an edge column first, as an ordinary grid
    // item, and the grid then sizes that column to hold it. Doing it the other
    // way round made a label's own width this code's problem, and a longer one
    // always found the edge of the figure.
    var kinds = columnKinds(graph)
    var edgeColumns = []
    kinds.forEach(function (kind, i) { if (kind === "edge") edgeColumns.push(i + 1) })
    var backSeen = 0
    edges.forEach(function (e) {
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
    var placed = graph.getBoundingClientRect()
    edges.forEach(function (e) {
      e.a = boxOf(e.fromNode, placed)
      e.b = boxOf(e.toNode, placed)
      if (e.slot) e.marker = boxOf(e.slot, placed)
    })

    assignLanes(edges)
    edges.forEach(function (e) {
      if (e.back) routeBack(e)
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
    labels.filter(function (item) { return item.at }).forEach(function (item) {
      var chip = document.createElement("div")
      chip.className = "figure-label"
      chip.style.left = item.at.x + "px"
      chip.style.top = item.at.y + "px"
      // The same kind the wire carries, so the stylesheet can give a label the
      // colour of the line it names rather than a border of its own.
      if (item.back) chip.setAttribute("data-kind", "back")
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
    var graph = this
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

  if (!customElements.get("figure-graph")) customElements.define("figure-graph", FigureGraph)
})()
