// Node module-customization hooks (node:module's register()) that let a
// template-embedded <script> block import another one — real ES modules,
// real import/export, no data: URL. See
// .mycelium/specs/2026-07-25-virtual-module-script-imports.spec.html.
//
// A specifier of the form "<path-to-html>#<locator>" is resolved to a
// synthetic file: URL sitting beside the real HTML file; load() re-parses
// that file and hands back the matching <script>'s text as the module's
// source. Nothing else is touched — any other specifier (a real relative
// file, a bare package, a node: builtin, today's existing
// data:text/javascript,… calls) falls through to Node's default resolver
// and loader unmodified.
//
// A bare "#<locator>" (no path) is the same-document shorthand href="#id"
// already has on the web: it addresses a script in the importing script's
// own file, not a different one. Only recognized when the importer is
// itself one of this mechanism's own synthetic virtual-module URLs — an
// ordinary file importing a bare "#foo" is Node's own reserved
// package-subpath-import syntax, so this hook leaves it for nextResolve,
// unmodified.
//
// <locator> is either a real id or a positional token "@N". A real id
// means an author wrote <script id="…">, so the script is addressable
// from outside its own file. "@N" is the Nth <script> tag in that
// document, computed identically at resolve time and load time from the
// same real file. Nobody writes it by hand — this hook mints it
// internally for a script that has no id but still needs some identity to
// run under. See the two decisions
// this implements: docs/knowledge/2026-07-25-virtual-module-extraction-not-concatenation.decision.html
// and docs/knowledge/2026-07-25-id-based-cross-script-imports.decision.html.

import { readFileSync } from "node:fs"
import { parseHTML } from "./utils.ts"

const MARKER = "__mycelium_virtual__"

interface ResolveContext {
  parentURL?: string
}

interface NextResolveResult {
  url: string
  shortCircuit?: boolean
  [key: string]: unknown
}

function isHtmlPath(pathname: string): boolean {
  return /\.html?$/.test(pathname)
}

function syntheticUrlFor(htmlPath: string, locator: string): string {
  const dir = htmlPath.slice(0, htmlPath.lastIndexOf("/"))
  const base = htmlPath.slice(htmlPath.lastIndexOf("/") + 1)
  return `file://${dir}/${base}.${MARKER}.${encodeURIComponent(locator)}.mjs`
}

// If url is one of this mechanism's own synthetic virtual-module URLs,
// returns the real .html file path it was derived from; otherwise null.
// The inverse of syntheticUrlFor, used to find "my own file" when a bare
// "#id" specifier gives no path of its own to resolve.
function realHtmlPathFromSyntheticUrl(url: string): string | null {
  if (!url.startsWith("file://") || !url.endsWith(".mjs")) return null
  const withoutScheme = url.slice("file://".length)
  const markerIndex = withoutScheme.lastIndexOf(`.${MARKER}.`)
  return markerIndex === -1 ? null : withoutScheme.slice(0, markerIndex)
}

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: (specifier: string, context: ResolveContext) => Promise<NextResolveResult>,
): Promise<NextResolveResult> {
  if (specifier.startsWith("#") && context.parentURL) {
    const htmlPath = realHtmlPathFromSyntheticUrl(context.parentURL)
    if (htmlPath) {
      const locator = decodeURIComponent(specifier.slice(1))
      return { url: syntheticUrlFor(htmlPath, locator), shortCircuit: true }
    }
  }
  if (specifier.includes("#")) {
    const parentURL = context.parentURL ?? `file://${process.cwd()}/`
    let resolved: URL
    try {
      resolved = new URL(specifier, parentURL)
    } catch {
      return nextResolve(specifier, context)
    }
    if (resolved.protocol === "file:" && resolved.hash.length > 1 && isHtmlPath(resolved.pathname)) {
      const locator = decodeURIComponent(resolved.hash.slice(1))
      const htmlPath = decodeURIComponent(resolved.pathname)
      return { url: syntheticUrlFor(htmlPath, locator), shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}

interface LoadContext {
  format?: string
  [key: string]: unknown
}

interface NextLoadResult {
  format: string
  source?: string | ArrayBuffer | Uint8Array
  shortCircuit?: boolean
  [key: string]: unknown
}

function findScript(document: Document, locator: string): Element | null {
  if (locator.startsWith("@")) {
    const index = Number(locator.slice(1))
    return document.querySelectorAll("script")[index] ?? null
  }
  return document.getElementById(locator)
}

// A script's type says where it runs, and that decides what language it may
// use. This hook is the only place a mycelium/* script ever loads, under
// Node — so it may be TypeScript, and this hook tells Node to strip it.
// Anything else the hook serves has to stay valid in a browser, so this
// hook hands it over unstripped. See
// .mycelium/specs/2026-08-01-script-type-decides-the-language.spec.html.
//
// Node does not sniff: "module" against a source carrying a type annotation is
// a SyntaxError, not a silent fallback. So this hook has to decide here, per
// script, rather than once for everything it loads — it is not reserved to
// mycelium/*. Telling Node that a browser-facing script may contain
// TypeScript would let syntax no browser can run pass unnoticed until the
// page is opened.
//
// Keyed on the prefix rather than a list of names, so a mycelium/* type this
// project has not invented yet arrives already covered.
function formatFor(script: Element): string {
  const type = script.getAttribute("type") ?? ""
  return type.startsWith("mycelium/") ? "module-typescript" : "module"
}

export async function load(
  url: string,
  context: LoadContext,
  nextLoad: (url: string, context: LoadContext) => Promise<NextLoadResult>,
): Promise<NextLoadResult> {
  const markerSegment = `.${MARKER}.`
  if (url.startsWith("file://") && url.includes(markerSegment) && url.endsWith(".mjs")) {
    const withoutScheme = url.slice("file://".length)
    const markerIndex = withoutScheme.lastIndexOf(markerSegment)
    const htmlPath = withoutScheme.slice(0, markerIndex)
    const encodedLocator = withoutScheme.slice(markerIndex + markerSegment.length, -".mjs".length)
    const locator = decodeURIComponent(encodedLocator)

    const html = readFileSync(htmlPath, "utf8")
    const { document } = parseHTML(html)
    const script = findScript(document as unknown as Document, locator)
    if (!script) throw new Error(`no script located by "${locator}" in ${htmlPath}`)

    return { format: formatFor(script), source: script.textContent ?? "", shortCircuit: true }
  }
  return nextLoad(url, context)
}
