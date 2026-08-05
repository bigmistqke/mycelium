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

  // Where a connector leaves one box and meets the next. Downward is the
  // common case and gets a vertical elbow; anything else leaves sideways, so a
  // line back up the figure does not run through the boxes between.
  function route(a, b) {
    if (b.top >= a.bottom - 1) {
      var midY = (a.bottom + b.top) / 2
      return "M" + a.midX + "," + a.bottom + " L" + a.midX + "," + midY +
             " L" + b.midX + "," + midY + " L" + b.midX + "," + b.top
    }
    var side = a.right + 18
    return "M" + a.right + "," + a.midY + " L" + side + "," + a.midY +
           " L" + side + "," + b.midY + " L" + b.right + "," + b.midY
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

    Array.prototype.forEach.call(graph.querySelectorAll("figure-edge"), function (edge) {
      var from = graph.querySelector('figure-node[id="' + edge.getAttribute("from") + '"]')
      var to = graph.querySelector('figure-node[id="' + edge.getAttribute("to") + '"]')
      // The audit catches a name that resolves to nothing, so skipping here
      // only covers a page opened without validation having run.
      if (!from || !to) return

      var a = boxOf(from, origin)
      var b = boxOf(to, origin)
      var path = document.createElementNS(SVG, "path")
      path.setAttribute("d", route(a, b))
      path.setAttribute("marker-end", "url(#" + marker.getAttribute("id") + ")")
      if (b.top < a.top) path.setAttribute("data-kind", "back")
      svg.appendChild(path)

      var label = edge.textContent.trim()
      if (!label) return
      var text = document.createElementNS(SVG, "text")
      text.setAttribute("x", (a.midX + b.midX) / 2 + 6)
      text.setAttribute("y", (a.midY + b.midY) / 2)
      text.setAttribute("text-anchor", "middle")
      text.textContent = label
      svg.appendChild(text)
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
    if (columns) graph.style.gridTemplateColumns = "repeat(" + columns + ", 1fr)"

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
