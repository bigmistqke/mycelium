// Reads the notebook out of a list of parsed documents: every notebook-*
// element becomes a node, every <a data-rel> inside one becomes an edge. Used
// by notebook.template.html's generate command.
//
// A file rather than a <script> in that template, for the reason
// docs/specs/2026-08-01-script-type-decides-the-language.spec.html gives: what
// the engine discovers lives in the document, what is merely called can live in
// a file. An audit is discovered by its type and stays embedded; this is only
// ever called by one, and gains nothing from being embedded.
//
// It used to be embedded, and the two audits each carried their own copy of it
// rather than importing it. That was because they also ran in a browser demo
// loaded from a data: URL, which has no base to resolve an import against.
// Removing the demo removed that copy too.

export interface GraphDocument {
  path: string
  dom: Document
}

export interface GraphNode {
  id: string
  type: string
  title: string
}

export interface GraphEdge {
  from: string
  to: string
  rel: string
  label: string
}

/**
 * Which element names count as nodes, from the caller that already knows.
 *
 * This held its own list until the family split one type into three, and a list
 * nobody updated left the drawing showing 50 of 387 entries while looking
 * exactly as correct as before. The command builds its tags off the type list
 * the schema declares, so taking them from there leaves one copy.
 */
export function extractGraph(
  documents: GraphDocument[],
  types: string[],
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
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
      const href = a.getAttribute("href")!
      // A same-document "#id" addresses a node in this file; anything else is
      // resolved against the document's own path so two files agree on what
      // they are naming.
      const to = href.startsWith("#") ? href.slice(1) : new URL(href, "file://" + path).pathname
      edges.push({
        from: source.id || path,
        to,
        rel: a.getAttribute("data-rel")!,
        label: a.textContent?.trim() ?? "",
      })
    }
  }
  return { nodes, edges }
}
