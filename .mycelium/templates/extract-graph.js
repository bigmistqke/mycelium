// Reads the notebook: a notebook-* element is a node, a data-rel <a> inside one is an edge.

/**
 * @typedef {object} GraphDocument
 * @property {string} path
 * @property {Document} dom
 */

/**
 * @typedef {object} GraphNode
 * @property {string} id
 * @property {string} type
 * @property {string} title
 */

/**
 * @typedef {object} GraphEdge
 * @property {string} from
 * @property {string} to
 * @property {string} rel
 * @property {string} label
 */

/**
 * Which element names count as nodes, from the caller that already knows.
 *
 * This held its own list until the family split one type into three, and a list
 * nobody updated left the drawing showing 50 of 387 entries while looking
 * exactly as correct as before. The command builds its tags off the type list
 * the schema declares, so taking them from there leaves one copy.
 *
 * @param {GraphDocument[]} documents
 * @param {string[]} types
 * @returns {{nodes: GraphNode[], edges: GraphEdge[]}}
 */
export function extractGraph(documents, types) {
  /** @type {GraphNode[]} */
  const nodes = []
  /** @type {GraphEdge[]} */
  const edges = []
  for (const { path, dom } of documents) {
    for (const tag of types) {
      const family = tag.split("-")[0]
      for (const el of Array.from(dom.querySelectorAll(tag))) {
        nodes.push({
          id: el.id || path,
          type: tag,
          title: el.querySelector(`${family}-title`)?.textContent?.trim() ?? "",
        })
      }
    }
    for (const a of Array.from(dom.querySelectorAll("a[data-rel]"))) {
      const source = a.closest(types.join(","))
      if (!source) continue
      const href = /** @type {string} */ (a.getAttribute("href"))
      // "#id" addresses a node in this file; anything else resolves against the document's own path.
      const to = href.startsWith("#") ? href.slice(1) : new URL(href, "file://" + path).pathname
      edges.push({
        from: source.id || path,
        to,
        rel: /** @type {string} */ (a.getAttribute("data-rel")),
        label: a.textContent?.trim() ?? "",
      })
    }
  }
  return { nodes, edges }
}
