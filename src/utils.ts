import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"
import type { Corpus } from "./api.ts"
import { Window } from "happy-dom"
import { parse as parse5Parse } from "parse5"
import ignoreFactory, { type Ignore } from "ignore"

// Where a corpus sits, relative to the working directory. One name serves this
// repository and any project installing this package, so what a consumer gets
// and what this project runs are one arrangement rather than two to keep in
// step. See .mycelium/specs/2026-08-17-mycelium-as-a-dependency.spec.html.
//
// The leading dot puts the directory behind walkFiles's own filter below, which
// steps over every dot-entry it meets. Nothing filters a root somebody names, so
// a walk handed this directory works and a walk starting above it finds nothing.
// That is why AuditFs carries the name rather than letting an audit repeat it.
export const CORPUS_DIR = ".mycelium"

export function parseHTML(html: string): { document: Document } {
  const window = new Window()
  window.document.write(html)
  return { document: window.document as unknown as Document }
}

// A second parse serves callers that need to map nodes back to exact byte
// ranges in the original text. Happy-dom (parseHTML above) never tracks this.
// parse5, the parser jsdom builds on, does this: when reading with
// sourceCodeLocationInfo enabled, every node carries its own range, split into
// startTag/endTag sub-ranges. Returns parse5's own tree shape
// (childNodes/tagName/sourceCodeLocation), not a DOM — a caller wanting to run
// a query still parses the same source again with parseHTML above and works
// from that tree instead; this one is for position only.
export function parseHTMLWithLocations(html: string): any {
  return parse5Parse(html, { sourceCodeLocationInfo: true })
}

// The first descendant with the given tag name, depth-first — for finding
// a known landmark (a document's own <body>) in whichever tree shape the
// caller handed in, parse5's included.
export function findFirstByTag(node: any, tag: string): any {
  for (const child of node.childNodes ?? []) {
    if (child.tagName?.toLowerCase() === tag) return child
    const found = findFirstByTag(child, tag)
    if (found) return found
  }
  return undefined
}

// The nearest .gitignore above a starting directory, compiled once and
// reused for every entry the walk that asked for it meets. Cached per
// starting directory rather than per call, since fs.list() runs walkFiles
// dozens of times over one validate and the file on disk cannot have
// changed between them.
//
// A project with no .gitignore anywhere above it gets null back — this
// package's own seed, freshly dropped into a consumer with no git history
// yet, is exactly that case. A null matcher ignores nothing, which is how
// walkFiles behaved before this existed.
const gitignoreCache = new Map<string, { root: string; ig: Ignore } | null>()

function gitignoreMatcher(startDir: string): { root: string; ig: Ignore } | null {
  const resolved = resolvePath(startDir)
  const cached = gitignoreCache.get(resolved)
  if (cached !== undefined) return cached

  let current = resolved
  let found: { root: string; ig: Ignore } | null = null
  while (true) {
    const candidate = join(current, ".gitignore")
    if (existsSync(candidate)) {
      found = { root: current, ig: ignoreFactory().add(readFileSync(candidate, "utf8")) }
      break
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  gitignoreCache.set(resolved, found)
  return found
}

// Every file under dir, recursively. node_modules is skipped: rooting an
// audit's filesystem above the corpus puts it in reach, and walking it would cost
// more than the rest of the tree by orders of magnitude. Anything the
// nearest .gitignore excludes is skipped the same way, since build output
// like .mycelium/page/ is no more a source file than node_modules is.
export function walkFiles(dir: string): string[] {
  return walkFilesUnder(dir, gitignoreMatcher(dir))
}

function walkFilesUnder(dir: string, matcher: { root: string; ig: Ignore } | null): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (matcher) {
      const path = relative(matcher.root, full)
      if (matcher.ig.ignores(stat.isDirectory() ? `${path}/` : path)) continue
    }
    if (stat.isDirectory()) results.push(...walkFilesUnder(full, matcher))
    else results.push(full)
  }
  return results
}

export function walkHtmlFiles(dir: string): string[] {
  return walkFiles(dir).filter((file) => file.endsWith(".html"))
}

// Given an instance's own file and its data-conforms-to value (a path
// relative to that file, plus a #fragment naming the type), resolves to
// "<absolute template file path>#<fragment>". That is the same key both
// the validator lookup below and validate.command.html's whole-corpus
// discovery use to find a type's <template>/<script data-validates> pair.
export function resolveTemplateRef(instanceFile: string, conformsTo: string): string {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

// Identifies a script within its own document for script-hooks.ts's
// resolve()/load() to re-find later: its own id if it declared one, making
// it importable from elsewhere, per
// docs/knowledge/2026-07-25-id-based-cross-script-imports.decision.html.
// Otherwise a positional token, computed identically here and in load(),
// derived from the file, never persisted or assigned randomly.
function locatorFor(script: Element): string {
  const id = script.getAttribute("id")
  if (id) return id
  // querySelectorAll("script") is typed as HTMLScriptElement here, while every
  // caller holds a plain Element, so compare as Element rather than widening
  // the parameter to something no caller has.
  const scripts = Array.from(script.ownerDocument!.querySelectorAll("script")) as Element[]
  return `@${scripts.indexOf(script)}`
}

// Runs a template-embedded <script> as a real ES module, addressed by its
// real file and its locator within that file (see locatorFor above).
// Registered once by run.ts, script-hooks.ts's
// resolve()/load() hooks turn "<file>#<locator>" into a synthetic file:
// URL sitting beside the real file, then re-extract that exact script's
// text as the module's source. Real file: URL, real hierarchical base, so the
// script's own relative imports (a shared helper, another family's
// validator via the same #locator form) resolve normally — unlike the
// data: URL this replaced, which had no base to resolve anything against.
// See .mycelium/specs/2026-07-25-virtual-module-script-imports.spec.html.
export async function loadModule(filePath: string, script: Element): Promise<Record<string, unknown>> {
  const locator = encodeURIComponent(locatorFor(script))
  const fileUrl = pathToFileURL(filePath).href
  return await import(`${fileUrl}#${locator}`)
}

// An audit or a type's own validator is one function, and the script tag
// holding it already says which — data-audits names the audit, data-validates
// names the type. So the export carries no name of its own, the same way a
// command host's default export saves `mycelium validate validate`.
//
// A language rule keeps a named `check`, and loads through loadModule rather
// than through here. Its export name is a term the language family already
// uses, so there it says something rather than repeating the tag.
export async function loadCheck(filePath: string, script: Element): Promise<(...args: unknown[]) => unknown> {
  const mod = await loadModule(filePath, script)
  return mod.default as (...args: unknown[]) => unknown
}

// Imports the one generic validator shared by every type that doesn't
// declare its own data-validates script (see template.template.html).
// A plain dynamic import, resolved by the same script-hooks.ts hook
// loadCheck's own loadModule relies on. run.ts already calls register()
// before any command reaches this function. validate.command.html's own
// script is no exception. So the hook is always active by the time it's
// called.
export async function loadGenericValidator(
  docsDir: string,
): Promise<(templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }> {
  const templateTemplateFile = resolvePath(docsDir, "templates/template.template.html")
  const mod = await import(`${pathToFileURL(templateTemplateFile).href}#validate-from-template`)
  return mod.validateFromTemplate as (templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }
}

// Validates one element against its own declared type, for callers (like
// run.ts's authoring commands) that only ever need to check a single node
// they just built or mutated — not validate.command.html's whole-corpus
// batch pass. Reads the referenced template file fresh on every call and
// never throws: an unresolvable reference is a reported failure, not an
// exception, the same way validate.command.html already treats it.
export async function validateInstance(
  docsDir: string,
  instancePath: string,
  element: Element,
): Promise<{ ok: boolean; errors: string[] }> {
  const conformsTo = element.getAttribute("data-conforms-to")
  if (!conformsTo) return { ok: false, errors: ["missing data-conforms-to attribute"] }

  const instanceFile = resolvePath(docsDir, instancePath)
  const key = resolveTemplateRef(instanceFile, conformsTo)
  const [templateFile, fragId] = key.split("#")

  try {
    const { document } = parseHTML(readFileSync(templateFile, "utf8"))
    const doc = document as unknown as Document
    const templateEl = doc.querySelector(`template#${fragId}`)
    if (!templateEl) return { ok: false, errors: [`no template found at ${key}`] }

    let generic: { ok: boolean; errors: string[] } | null = null
    try {
      const genericCheck = await loadGenericValidator(docsDir)
      generic = genericCheck(templateEl as unknown as Element, element)
    } catch {
      // No template.template.html in this docs tree -- fall back to
      // requiring the type's own data-validates script, same as before
      // this feature existed.
    }

    const script = doc.querySelector(`script[data-validates="#${fragId}"]`)
    if (!script) {
      if (generic) return generic
      return { ok: false, errors: [`no generic validator available and no data-validates script for ${key}`] }
    }

    const check = await loadCheck(templateFile, script)
    const custom = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    const customErrors = (custom.errors ?? custom.violations ?? []) as string[]
    if (!generic) return { ok: custom.ok, errors: customErrors }
    return { ok: generic.ok && custom.ok, errors: [...generic.errors, ...customErrors] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${(err as Error).message}`] }
  }
}

// Drains stdin fully and returns it as a string. The only new shared
// primitive this project needs for rich-content authoring — what a
// command's own `-` sentinel means (if anything) is domain knowledge
// that stays in the command, not here.
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

/**
 * A read-only view of a project, rooted one level above its corpus.
 *
 * Two callers want the same thing for the same reason. A rule about language
 * covers a comment in a source file as much as prose in a document, so an
 * audit has to reach past the corpus to say so. A probe hits that wall the
 * moment it asks about src/. Building the view twice would leave a probe
 * measuring a project the audits cannot see.
 *
 * Nothing here parses until somebody asks. Listing answers with paths, so
 * filtering by name costs a string comparison rather than a document, and the
 * cache makes a second reader of the same file free.
 *
 * parse() opens a real happy-dom Window per document and hands back its
 * document, discarding the window — and a discarded window still stays
 * reachable from its own browser context until something calls its own
 * close(). A window nobody closes never becomes garbage, regardless of
 * whether the caller still holds the document.
 *
 * Harmless for a command that parses a few hundred documents once and
 * exits. Fatal for one that does it every few seconds in the same process,
 * since every rebuild adds its own few hundred windows to what the last
 * rebuild already left behind. See
 * ../notebook/the-watching-graph-server-exhausts-a-two-gigabyte-heap-after-roughly-a-dozen-rebuilds.practice.html
 * for the two gigabytes that cost.
 *
 * dispose() closes every window this view opened. A caller that runs once
 * never needs it — the process exiting reclaims everything regardless — so
 * the cost of not calling it is zero there and real everywhere else.
 */
export function corpusView(root: string, docsDir: string, cache = new Map<string, Document>()): Corpus {
  const windows: { happyDOM: { close(): Promise<void> } }[] = []

  return {
    root,
    docsDir,
    list(dir = ".", options: { ext?: string } = {}) {
      // A directory that does not exist holds no files, which is an answer
      // rather than an error. Asking about a family with no entries yet gets
      // an empty list, not a thrown call.
      const full = resolvePath(root, dir)
      if (!existsSync(full)) return []
      return walkFiles(full)
        .filter((file) => !options.ext || file.endsWith(options.ext))
        .map((file) => relative(root, file))
    },
    read(path: string) {
      return readFileSync(resolvePath(root, path), "utf8")
    },
    exists(path: string) {
      return existsSync(resolvePath(root, path))
    },
    parse(path: string) {
      const full = resolvePath(root, path)
      let doc = cache.get(full)
      if (!doc) {
        const { document } = parseHTML(readFileSync(full, "utf8"))
        doc = document as unknown as Document
        // Reached through defaultView rather than kept from parseHTML's own
        // return value, which keeps that signature untouched for its dozens
        // of other callers. This is the one caller that needs the window
        // back, not a reason for everyone else to carry it.
        const window = (doc as unknown as { defaultView?: { happyDOM: { close(): Promise<void> } } }).defaultView
        if (window) windows.push(window)
        cache.set(full, doc)
      }
      return doc
    },
    dispose() {
      // Not awaited. happy-dom's own close() finishes asynchronously, and a
      // caller disposing is about to sit idle until the next rebuild or exit.
      // That idle time is what a tight loop never gives a fire-and-forget
      // call, and here it is free.
      for (const window of windows.splice(0)) window.happyDOM.close()
      cache.clear()
    },
  }
}
