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
      var y = a.bottom + gap / 2 + lane * 6
      return {
        d: "M" + a.midX + "," + a.bottom + " L" + a.midX + "," + y +
           " L" + b.midX + "," + y + " L" + b.midX + "," + b.top,
        // On the vertical drop, halfway between the elbow and the box. Sitting
        // it just above the target put it on the arrowhead, where the label and
        // the thing it points at fight for the same few pixels.
        label: { x: b.midX, y: (y + b.top) / 2 },
      }
    }
    // Anything not going downward leaves sideways, so a line back up the figure
    // does not run through the boxes between.
    // Far enough out that a label centred on the line still clears the boxes
    // this route passes. Hugging them and nudging the label aside instead was
    // worse: a chip beside a wire stops reading as that wire's label, and the
    // overlap it avoided was the route's fault rather than the label's.
    var side = a.right + 56 + lane * 12
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

    // Which lane an edge takes, counted per source box. Two edges leaving the
    // same node would otherwise draw the same elbow twice.
    var lanes = {}
    var labels = []

    // Every wire first, before any label. SVG paints in document order, so a
    // label drawn during its own edge's turn still ends up under the wires of
    // every edge after it. That struck through two of the three labels in the
    // first render: the third edge's horizontal lane ran at exactly the height
    // the first two had put their text.
    Array.prototype.forEach.call(graph.querySelectorAll("figure-edge"), function (edge) {
      var fromName = edge.getAttribute("from")
      var from = graph.querySelector('figure-node[id="' + fromName + '"]')
      var to = graph.querySelector('figure-node[id="' + edge.getAttribute("to") + '"]')
      // The audit catches a name that resolves to nothing, so skipping here
      // only covers a page opened without validation having run.
      if (!from || !to) return

      var a = boxOf(from, origin)
      var b = boxOf(to, origin)
      lanes[fromName] = (lanes[fromName] || 0) + 1
      var wire = route(a, b, lanes[fromName] - 1)

      // Read, not measured. Comparing box positions would let a rearrangement
      // restyle an edge with nothing in the document changing, and an inference
      // from measured state always has a wrong answer available to it. The
      // audit checks the declaration against the rows, so a lie fails the build
      // rather than rendering.
      var back = edge.hasAttribute("data-back")

      var path = document.createElementNS(SVG, "path")
      path.setAttribute("class", "wire")
      path.setAttribute("d", wire.d)
      path.setAttribute("marker-end", "url(#" + marker.getAttribute("id") + ")")
      if (back) path.setAttribute("data-kind", "back")
      svg.appendChild(path)

      var label = edge.textContent.trim()
      if (label) labels.push({ text: label, at: wire.label, back: back })
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
    labels.forEach(function (item) {
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
