// The page a ranked graph draws itself into: a header carrying counts, a grid
// for the columns, a canvas for the wires, and a pane for whatever a reader
// selects.
//
// Every graph gets the same shell, because every graph gets the same drawing.
// What differs is the title, the counts and the data, and those arrive as
// arguments.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

export interface GraphPage {
  title: string
  /**
   * The counts line, as markup. Each graph counts different things, and the
   * wires-over-boxes stat gets appended here so a page that measured nothing
   * can drop it.
   */
  counts: string
  /** The id the data sits under, which the drawing reads it back from. */
  dataId: string
  data: unknown
  /**
   * A base tag, or nothing. A page written outside the documents directory
   * needs one to resolve the links it carries back into the corpus.
   */
  base?: string
  /**
   * The scripts to inline, in order. The shared drawing comes first and the
   * caller's own ranking second, since the second calls what the first
   * defines.
   */
  scripts: string[]
}

/**
 * Read one of this project's own files by name.
 *
 * Read rather than embedded, so the page's code and styling stay files a person
 * can open and an editor can check. Inlined rather than linked, so a page
 * somebody moves still draws.
 */
export function templateFile(name: string): string {
  return readFileSync(join(here, name), "utf8")
}

export function graphPage(page: GraphPage): string {
  const closing = "<" + "/script"
  const json = JSON.stringify(page.data).split(closing).join("<\\/script")
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
${page.base ?? ""}
<style>
${templateFile("graph.template.css")}
</style>
</head>
<body>
<header>
  <h1>${page.title}</h1>
  <div class="counts">
    ${page.counts}<span class="stat"> &middot;
    <b id="crossings">—</b> wires over boxes</span>
  </div>
</header>
<div id="grid"><svg id="wires"></svg><svg id="wires-lit"></svg></div>
<aside id="pane" hidden>
  <button id="pane-close" type="button" aria-label="close">&times;</button>
  <h2 id="pane-title"></h2>
  <div id="pane-meta">
    <p id="pane-where"></p>
    <p id="pane-reach"></p>
  </div>
  <div id="pane-detail"></div>
  <div id="pane-links"></div>
</aside>
<script type="application/json" id="${page.dataId}">${json}${closing}>
<script>
${page.scripts.join("\n")}
${closing}>
</body>
</html>
`
}
