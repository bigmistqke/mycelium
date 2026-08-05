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

  // Where a connector leaves one box and meets the next, and where its label
  // belongs. The label anchor comes back with the path because it has to sit ON
  // the path: an earlier version averaged the two boxes' centres, which put the
  // back edge's label a hundred pixels from the line it named.
  //
  // Downward is the common case and gets a vertical elbow. Several edges
  // leaving one box would share an elbow height and overprint each other, so
  // each drops into its own lane, and the label goes just above its target
  // where the columns already separate them.
  function route(a, b, lane) {
    if (b.top >= a.bottom - 1) {
      var gap = b.top - a.bottom
      var y = a.bottom + Math.min(10 + lane * 6, gap * 0.75)
      return {
        d: "M" + a.midX + "," + a.bottom + " L" + a.midX + "," + y +
           " L" + b.midX + "," + y + " L" + b.midX + "," + b.top,
        label: { x: b.midX, y: b.top - 9 },
      }
    }
    // Anything not going downward leaves sideways, so a line back up the figure
    // does not run through the boxes between.
    var side = a.right + 18 + lane * 10
    return {
      d: "M" + a.right + "," + a.midY + " L" + side + "," + a.midY +
         " L" + side + "," + b.midY + " L" + b.right + "," + b.midY,
      label: { x: side, y: (a.midY + b.midY) / 2 },
    }
  }

  var SVG = "http://www.w3.org/2000/svg"

  function draw(graph) {
    var origin = graph.getBoundingClientRect()
    var old = graph.querySelector("svg.figure-wires")
    if (old) old.remove()

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

    // Which lane an edge takes, counted per source box. Two edges leaving the
    // same node would otherwise draw the same elbow twice.
    var lanes = {}

    Array.prototype.forEach.call(graph.querySelectorAll("figure-edge"), function (edge) {
      var fromName = edge.getAttribute("from")
      var from = graph.querySelector('figure-node[id="' + fromName + '"]')
      var to = graph.querySelector('figure-node[id="' + edge.getAttribute("to") + '"]')
      // The audit catches a name that resolves to nothing, so skipping here
      // only covers a page opened without validation having run.
      if (!from || !to) return

      lanes[fromName] = (lanes[fromName] || 0) + 1
      var wire = route(boxOf(from, origin), boxOf(to, origin), lanes[fromName] - 1)

      var path = document.createElementNS(SVG, "path")
      path.setAttribute("class", "wire")
      path.setAttribute("d", wire.d)
      path.setAttribute("marker-end", "url(#" + marker.getAttribute("id") + ")")
      if (boxOf(to, origin).top < boxOf(from, origin).top) path.setAttribute("data-kind", "back")
      svg.appendChild(path)

      var label = edge.textContent.trim()
      if (!label) return
      // A rect behind the text, sized from the glyphs once they exist. A stroke
      // halo left the wire showing through the gaps between words, so "js ts
      // tsx" read as one underscored word.
      var text = document.createElementNS(SVG, "text")
      text.setAttribute("x", wire.label.x)
      text.setAttribute("y", wire.label.y)
      text.setAttribute("text-anchor", "middle")
      text.textContent = label
      svg.appendChild(text)

      var box = text.getBBox()
      var bed = document.createElementNS(SVG, "rect")
      bed.setAttribute("class", "label-bed")
      bed.setAttribute("x", box.x - 3)
      bed.setAttribute("y", box.y - 1)
      bed.setAttribute("width", box.width + 6)
      bed.setAttribute("height", box.height + 2)
      svg.insertBefore(bed, text)
    })

    graph.insertBefore(svg, graph.firstChild)
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
