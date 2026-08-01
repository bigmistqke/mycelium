// Reads a knowledge graph out of a list of parsed documents: every
// knowledge-* element becomes a node, every <a data-rel> inside one becomes an
// edge. Used by knowledge.template.html's two edge-reading audits
// (orphans-except-goal, dangling-outcome) and by its generate command.
//
// A file rather than a <script> in that template, for the reason
// docs/specs/2026-08-01-script-type-decides-the-language.spec.html gives: what
// the engine discovers lives in the document, what is merely called can live in
// a file. An audit is discovered by its type and stays embedded; this is only
// ever called by one, and gains nothing from being embedded.
//
// It used to be embedded, and the two audits each carried their own copy of it
// rather than importing it, because they also ran in a browser demo loaded from
// a data: URL, which has no base to resolve an import against. The demo is gone
// and so is the copy.

export interface GraphDocument {
  path: string
  dom: Document
}

export interface GraphNode {
  id: string
  type: string
  title: string
  status: string
}

export interface GraphEdge {
  from: string
  to: string
  rel: string
  label: string
}

const TYPES = [
  "knowledge-goal",
  "knowledge-decision",
  "knowledge-option",
  "knowledge-action",
  "knowledge-outcome",
  "knowledge-observation",
]

export function extractGraph(documents: GraphDocument[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []
  for (const { path, dom } of documents) {
    for (const tag of TYPES) {
      const family = tag.split("-")[0]
      for (const el of Array.from(dom.querySelectorAll(tag))) {
        nodes.push({
          id: el.id || path,
          type: tag,
          title: el.querySelector(`${family}-title`)?.textContent?.trim() ?? "",
          status: el.querySelector(`${family}-status`)?.textContent?.trim() ?? "",
        })
      }
    }
    for (const a of Array.from(dom.querySelectorAll("a[data-rel]"))) {
      const source = a.closest(TYPES.join(","))
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
