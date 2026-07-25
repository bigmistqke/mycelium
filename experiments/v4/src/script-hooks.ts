// Node module-customization hooks (node:module's register()) that let a
// template-embedded <script> block import another one — real ES modules,
// real import/export, no data: URL. See
// docs/specs/2026-07-25-virtual-module-script-imports.spec.html.
//
// A specifier of the form "<path-to-html>#<locator>" is resolved to a
// synthetic file: URL sitting beside the real HTML file; load() re-parses
// that file and hands back the matching <script>'s text as the module's
// source. Nothing else is touched — any other specifier (a real relative
// file, a bare package, a node: builtin, today's existing
// data:text/javascript,… calls) falls through to Node's default resolver
// and loader unmodified.
//
// <locator> is either a real id (an author wrote <script id="…">, so the
// script is addressable from outside its own file) or a positional token
// "@N" (the Nth <script> tag in that document, computed identically at
// resolve time and load time from the same real file) — the latter is
// never written by hand, only minted internally for a script that has no
// id but still needs some identity to run under. See the two decisions
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

export async function resolve(
  specifier: string,
  context: ResolveContext,
  nextResolve: (specifier: string, context: ResolveContext) => Promise<NextResolveResult>,
): Promise<NextResolveResult> {
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
      const dir = htmlPath.slice(0, htmlPath.lastIndexOf("/"))
      const base = htmlPath.slice(htmlPath.lastIndexOf("/") + 1)
      const syntheticUrl = `file://${dir}/${base}.${MARKER}.${encodeURIComponent(locator)}.mjs`
      return { url: syntheticUrl, shortCircuit: true }
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

    return { format: "module", source: script.textContent ?? "", shortCircuit: true }
  }
  return nextLoad(url, context)
}
