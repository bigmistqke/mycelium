import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
/** @import { Corpus } from "./api.ts" */
import { Window } from "happy-dom"
import { parse as parse5Parse } from "parse5"
import ignoreFactory from "ignore"
/** @import { Ignore } from "ignore" */
import { detect } from "package-manager-detector/detect"
import { resolveCommand } from "package-manager-detector/commands"

/**
 * Where a corpus sits, relative to the working directory. One name serves this
 * repository and any project installing this package, so what a consumer gets
 * and what this project runs are one arrangement rather than two to keep in
 * step. See .mycelium/specs/2026-08-17-mycelium-as-a-dependency.spec.html.
 *
 * The leading dot puts the directory behind walkFiles's own filter below, which
 * steps over every dot-entry it meets. Nothing filters a root somebody names, so
 * a walk handed this directory works and a walk starting above it finds nothing.
 * That is why AuditFs carries the name rather than letting an audit repeat it.
 */
export const CORPUS_DIR = ".mycelium"

/**
 * @param {string} html
 * @returns {{document: Document}}
 */
export function parseHTML(html) {
  const window = new Window()
  window.document.write(html)
  return { document: /** @type {Document} */ (/** @type {unknown} */ (window.document)) }
}

/**
 * A second parse serves callers that need to map nodes back to exact byte
 * ranges in the original text. Happy-dom (parseHTML above) never tracks this.
 * parse5, the parser jsdom builds on, does this: when reading with
 * sourceCodeLocationInfo enabled, every node carries its own range, split into
 * startTag/endTag sub-ranges. Returns parse5's own tree shape
 * (childNodes/tagName/sourceCodeLocation), not a DOM — a caller wanting to run
 * a query still parses the same source again with parseHTML above and works
 * from that tree instead; this one is for position only.
 *
 * @param {string} html
 * @returns {any}
 */
export function parseHTMLWithLocations(html) {
  return parse5Parse(html, { sourceCodeLocationInfo: true })
}

/**
 * The first descendant with the given tag name, depth-first — for finding
 * a known landmark (a document's own <body>) in whichever tree shape the
 * caller handed in, parse5's included.
 *
 * @param {any} node
 * @param {string} tag
 * @returns {any}
 */
export function findFirstByTag(node, tag) {
  for (const child of node.childNodes ?? []) {
    if (child.tagName?.toLowerCase() === tag) return child
    const found = findFirstByTag(child, tag)
    if (found) return found
  }
  return undefined
}

/** @typedef {{root: string, ig: Ignore}} GitignoreMatcher */

/**
 * The nearest .gitignore above a starting directory, compiled once and
 * reused for every entry the walk that asked for it meets. Cached per
 * starting directory rather than per call, since fs.list() runs walkFiles
 * dozens of times over one validate and the file on disk cannot have
 * changed between them.
 *
 * A project with no .gitignore anywhere above it gets null back — this
 * package's own seed, freshly dropped into a consumer with no git history
 * yet, is exactly that case. A null matcher ignores nothing, which is how
 * walkFiles behaved before this existed.
 *
 * @type {Map<string, GitignoreMatcher | null>}
 */
const gitignoreCache = new Map()

/**
 * @param {string} startDir
 * @returns {GitignoreMatcher | null}
 */
function gitignoreMatcher(startDir) {
  const resolved = resolvePath(startDir)
  const cached = gitignoreCache.get(resolved)
  if (cached !== undefined) return cached

  let current = resolved
  /** @type {GitignoreMatcher | null} */
  let found = null
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

/**
 * Every file under dir, recursively. node_modules is skipped: rooting an
 * audit's filesystem above the corpus puts it in reach, and walking it would cost
 * more than the rest of the tree by orders of magnitude. Anything the
 * nearest .gitignore excludes is skipped the same way, since build output
 * like .mycelium/page/ is no more a source file than node_modules is.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function walkFiles(dir) {
  return walkFilesUnder(dir, gitignoreMatcher(dir))
}

/**
 * @param {string} dir
 * @param {GitignoreMatcher | null} matcher
 * @returns {string[]}
 */
function walkFilesUnder(dir, matcher) {
  /** @type {string[]} */
  const results = []
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

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function walkHtmlFiles(dir) {
  return walkFiles(dir).filter((file) => file.endsWith(".html"))
}

/**
 * Given an instance's own file and its data-conforms-to value (a path
 * relative to that file, plus a #fragment naming the type), resolves to
 * "<absolute template file path>#<fragment>". That is the same key both
 * the validator lookup below and validate.command.html's whole-corpus
 * discovery use to find a type's <template>/<script data-validates> pair.
 *
 * @param {string} instanceFile
 * @param {string} conformsTo
 * @returns {string}
 */
export function resolveTemplateRef(instanceFile, conformsTo) {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

/**
 * Identifies a script within its own document for script-hooks.js's
 * resolve()/load() to re-find later: its own id if it declared one, making
 * it importable from elsewhere, per
 * docs/knowledge/2026-07-25-id-based-cross-script-imports.decision.html.
 * Otherwise a positional token, computed identically here and in load(),
 * derived from the file, never persisted or assigned randomly.
 *
 * @param {Element} script
 * @returns {string}
 */
function locatorFor(script) {
  const id = script.getAttribute("id")
  if (id) return id
  // Cast to Element[]: querySelectorAll("script") is HTMLScriptElement[], every caller holds plain Element.
  const scripts = /** @type {Element[]} */ (Array.from(/** @type {Document} */ (script.ownerDocument).querySelectorAll("script")))
  return `@${scripts.indexOf(script)}`
}

/**
 * Runs a template-embedded <script> as a real ES module, addressed by its
 * real file and its locator within that file (see locatorFor above).
 * Registered once by run.js, script-hooks.js's
 * resolve()/load() hooks turn "<file>#<locator>" into a synthetic file:
 * URL sitting beside the real file, then re-extract that exact script's
 * text as the module's source. Real file: URL, real hierarchical base, so the
 * script's own relative imports (a shared helper, another family's
 * validator via the same #locator form) resolve normally — unlike the
 * data: URL this replaced, which had no base to resolve anything against.
 * See .mycelium/specs/2026-07-25-virtual-module-script-imports.spec.html.
 *
 * @param {string} filePath
 * @param {Element} script
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadModule(filePath, script) {
  const locator = encodeURIComponent(locatorFor(script))
  const fileUrl = pathToFileURL(filePath).href
  return await import(`${fileUrl}#${locator}`)
}

/**
 * An audit or a type's own validator is one function, and the script tag
 * holding it already says which — data-audits names the audit, data-validates
 * names the type. So the export carries no name of its own, the same way a
 * command host's default export saves `mycelium validate validate`.
 *
 * A language rule keeps a named `check`, and loads through loadModule rather
 * than through here. Its export name is a term the language family already
 * uses, so there it says something rather than repeating the tag.
 *
 * @param {string} filePath
 * @param {Element} script
 * @returns {Promise<(...args: unknown[]) => unknown>}
 */
export async function loadCheck(filePath, script) {
  const mod = await loadModule(filePath, script)
  return /** @type {(...args: unknown[]) => unknown} */ (mod.default)
}

/** @typedef {{ok: boolean, errors: string[]}} ValidationResult */

/**
 * Imports the one generic validator shared by every type that doesn't
 * declare its own data-validates script (see template.template.html).
 * A plain dynamic import, resolved by the same script-hooks.js hook
 * loadCheck's own loadModule relies on. run.js already calls register()
 * before any command reaches this function. validate.command.html's own
 * script is no exception. So the hook is always active by the time it's
 * called.
 *
 * @param {string} docsDir
 * @returns {Promise<(templateEl: Element, instanceEl: Element) => ValidationResult>}
 */
export async function loadGenericValidator(docsDir) {
  const templateTemplateFile = resolvePath(docsDir, "templates/template.template.html")
  const mod = await import(`${pathToFileURL(templateTemplateFile).href}#validate-from-template`)
  return /** @type {(templateEl: Element, instanceEl: Element) => ValidationResult} */ (mod.validateFromTemplate)
}

/**
 * Validates one element against its own declared type, for callers (like
 * run.js's authoring commands) that only ever need to check a single node
 * they just built or mutated — not validate.command.html's whole-corpus
 * batch pass. Reads the referenced template file fresh on every call and
 * never throws: an unresolvable reference is a reported failure, not an
 * exception, the same way validate.command.html already treats it.
 *
 * @param {string} docsDir
 * @param {string} instancePath
 * @param {Element} element
 * @returns {Promise<ValidationResult>}
 */
export async function validateInstance(docsDir, instancePath, element) {
  const conformsTo = element.getAttribute("data-conforms-to")
  if (!conformsTo) return { ok: false, errors: ["missing data-conforms-to attribute"] }

  const instanceFile = resolvePath(docsDir, instancePath)
  const key = resolveTemplateRef(instanceFile, conformsTo)
  const [templateFile, fragId] = key.split("#")

  try {
    const { document } = parseHTML(readFileSync(templateFile, "utf8"))
    const doc = /** @type {Document} */ (/** @type {unknown} */ (document))
    const templateEl = doc.querySelector(`template#${fragId}`)
    if (!templateEl) return { ok: false, errors: [`no template found at ${key}`] }

    /** @type {ValidationResult | null} */
    let generic = null
    try {
      const genericCheck = await loadGenericValidator(docsDir)
      generic = genericCheck(/** @type {Element} */ (/** @type {unknown} */ (templateEl)), element)
    } catch {
      // No template.template.html here: fall back to a type's own data-validates script.
    }

    const script = doc.querySelector(`script[data-validates="#${fragId}"]`)
    if (!script) {
      if (generic) return generic
      return { ok: false, errors: [`no generic validator available and no data-validates script for ${key}`] }
    }

    const check = await loadCheck(templateFile, script)
    const custom = /** @type {{ok: boolean, errors?: string[], violations?: string[]}} */ (check(element))
    const customErrors = /** @type {string[]} */ (custom.errors ?? custom.violations ?? [])
    if (!generic) return { ok: custom.ok, errors: customErrors }
    return { ok: generic.ok && custom.ok, errors: [...generic.errors, ...customErrors] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${/** @type {Error} */ (err).message}`] }
  }
}

/**
 * Drains stdin fully and returns it as a string. The only new shared
 * primitive this project needs for rich-content authoring — what a
 * command's own `-` sentinel means (if anything) is domain knowledge
 * that stays in the command, not here.
 *
 * @returns {Promise<string>}
 */
export async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = []
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
 *
 * @param {string} root
 * @param {string} docsDir
 * @param {Map<string, Document>} [cache]
 * @returns {Corpus}
 */
export function corpusView(root, docsDir, cache = new Map()) {
  /** @type {{happyDOM: {close(): Promise<void>}}[]} */
  const windows = []

  return {
    root,
    docsDir,
    /**
     * @param {string} [dir]
     * @param {{ext?: string}} [options]
     */
    list(dir = ".", options = {}) {
      // A missing directory holds no files: an empty list, not a thrown call.
      const full = resolvePath(root, dir)
      if (!existsSync(full)) return []
      return walkFiles(full)
        .filter((file) => !options.ext || file.endsWith(options.ext))
        .map((file) => relative(root, file))
    },
    /** @param {string} path */
    read(path) {
      return readFileSync(resolvePath(root, path), "utf8")
    },
    /** @param {string} path */
    exists(path) {
      return existsSync(resolvePath(root, path))
    },
    /** @param {string} path */
    parse(path) {
      const full = resolvePath(root, path)
      let doc = cache.get(full)
      if (!doc) {
        const { document } = parseHTML(readFileSync(full, "utf8"))
        doc = /** @type {Document} */ (/** @type {unknown} */ (document))
        // Reached via defaultView rather than widening parseHTML's own return value for every other caller.
        const window = /** @type {{defaultView?: {happyDOM: {close(): Promise<void>}}}} */ (/** @type {unknown} */ (doc)).defaultView
        if (window) windows.push(window)
        cache.set(full, doc)
      }
      return doc
    },
    dispose() {
      // Not awaited: happy-dom's close() is async, and idle time until the next rebuild covers it for free.
      for (const window of windows.splice(0)) window.happyDOM.close()
      cache.clear()
    },
  }
}

/**
 * Installs { name: version } pairs into a project via its own package
 * manager, detected from what already got it there.
 *
 * package-manager-detector finds which manager the consumer already used —
 * a lockfile is already there by construction, since installing anything
 * at all is what put one there — and resolves that manager's own add
 * command. The package manager writes its own package.json and lockfile;
 * this never parses or edits either by hand.
 *
 * @param {Map<string, string>} dependencies
 * @param {string} repoRoot
 * @param {(line: string) => void} out
 * @returns {Promise<void>}
 */
export async function installPackages(dependencies, repoRoot, out) {
  if (dependencies.size === 0) return

  const specs = [...dependencies].map(([name, version]) => `${name}@${version}`)
  const pm = await detect({ cwd: repoRoot })
  if (!pm) {
    out(`needs: ${specs.join(", ")} — no package manager detected, add them yourself.`)
    return
  }
  const resolved = resolveCommand(pm.agent, "add", specs)
  if (!resolved) {
    out(`needs: ${specs.join(", ")} — ${pm.agent} has no add command, add them yourself.`)
    return
  }
  out(`installing ${specs.join(" ")} with ${resolved.command} ${resolved.args.join(" ")}`)
  spawnSync(resolved.command, resolved.args, { cwd: repoRoot, stdio: "inherit" })
}
