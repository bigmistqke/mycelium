// Protocol-only engine. See .mycelium/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, unlinkSync } from "node:fs"
import { basename, dirname, join, posix, relative as relativePath, resolve as resolvePath } from "node:path"
import { register } from "node:module"
import { spawnSync } from "node:child_process"
import ts from "typescript"
import { detect } from "package-manager-detector/detect"
import { resolveCommand } from "package-manager-detector/commands"
import { CORPUS_DIR, parseHTML, parseHTMLWithLocations, walkFiles, walkHtmlFiles, validateInstance, readStdin, loadModule } from "./utils.js"
import { readCommands } from "../.mycelium/templates/shared.js"
/** @import { CommandEntry } from "../.mycelium/templates/shared.js" */

register("./script-hooks.js", import.meta.url)

// Command shapes live in api.ts, imported by embedded scripts too.
/** @import { Cli, CommandContext, ParsedArgs, Validate } from "./api.ts" */

// A command host is a family's <id>.template.html or a singleton <id>.command.html.
const TEMPLATE_FILE_SUFFIXES = ["template.html", "command.html"]

/**
 * @param {string} dir
 * @param {string} id
 * @returns {string | null}
 */
function findTemplateFile(dir, id) {
  const files = walkHtmlFiles(dir)
  for (const suffix of TEMPLATE_FILE_SUFFIXES) {
    const target = `${id}.${suffix}`
    const found = files.find((f) => f.endsWith(`/${target}`))
    if (found) return found
  }
  return null
}

// Where this package's own corpus sits, checkout or node_modules — both look the same from here.
const PACKAGE_CORPUS = resolvePath(import.meta.dirname, "..", CORPUS_DIR)

// Where a seeded document's outward links point once they leave this repository.
const PUBLISHED_SITE = "https://bigmistqke.github.io/mycelium/"

// The families a new corpus starts with; canon/spec/plan/figure wait until a family has an instance to seed.
const SEED_FAMILIES = ["template", "notebook", "language", "followup"]

/**
 * Every local file a document needs to load, run or validate against. A
 * stylesheet or script it links, the template it conforms to, and — inside
 * whatever <script> it carries — a relative import and any bare filename
 * literal ending .css, .js or .html that names a real file.
 *
 * Parsed throughout, never pattern-matched over raw text. happy-dom reads
 * the markup and the TypeScript compiler reads a script's own source, the
 * same way shared.ts's readCommands already reads one.
 *
 * <a href> never counts. That is a citation to other content, not something
 * a document needs in order to run, and following it would pull in most of
 * the corpus.
 *
 * A bare literal carries no directory of its own — graph.lib.html names
 * graph.template.css that way, through its own file-reading helper rather
 * than an href. A script tag a command writes into a fresh instance is
 * relative to wherever that instance ends up living, not to the template
 * writing it. Both fall back to the corpus root, checked by basename alone,
 * which is where every file either shape has needed to reach so far. A
 * reference the fallback still cannot resolve is dropped rather than
 * guessed at.
 *
 * @param {string} html
 * @param {string} ownDir
 * @returns {string[]}
 */
function localReferences(html, ownDir) {
  /** @type {Set<string>} */
  const found = new Set()
  /** @param {string} spec */
  const consider = (spec) => {
    const target = spec.split("#")[0]
    if (!target) return
    const direct = resolvePath(ownDir, target)
    const path = existsSync(direct) ? direct : resolvePath(PACKAGE_CORPUS, basename(target))
    if (existsSync(path) && statSync(path).isFile()) found.add(path)
  }

  const { document } = parseHTML(html)
  for (const el of Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'))) {
    consider(el.getAttribute("href") ?? "")
  }
  // Every instance names its own template, which validate opens too, so it has to reach a consumer as well.
  for (const el of Array.from(document.querySelectorAll("[data-conforms-to]"))) {
    consider(el.getAttribute("data-conforms-to") ?? "")
  }
  for (const el of Array.from(document.querySelectorAll("script[src]"))) {
    consider(el.getAttribute("src") ?? "")
  }

  for (const el of Array.from(document.querySelectorAll("script"))) {
    if (el.hasAttribute("src")) continue
    const source = el.textContent ?? ""
    if (!source.trim()) continue
    const sourceFile = ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
    /** @param {ts.Node} node */
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        consider(node.moduleSpecifier.text)
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        // A generated instance's own markup lives in a literal; run the same <link>/<script src> query on it.
        if (/<script[\s>]|<link[\s>]/.test(node.text)) {
          for (const nested of localReferences(node.text, ownDir)) found.add(nested)
        } else if (/^[\w.-]+\.(css|js|html)$/.test(node.text)) {
          consider(node.text)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }

  return [...found]
}

/**
 * Every file a fresh corpus gets, as paths relative to the corpus root.
 *
 * The family templates plus everything under language/ and commands/ are
 * collections a fresh corpus wants wholesale — nothing about what one
 * document references would ever derive those. What each of them needs
 * beyond itself is a different question, and localReferences answers it:
 * starting from this set, every file it turns up joins the set and gets
 * asked the same question, until a pass finds nothing new. A family's own
 * stylesheet no longer needs its own line here, since the template's own
 * <link> already says it needs one.
 *
 * @returns {string[]}
 */
function seedPaths() {
  /** @type {string[]} */
  const roots = ["theme.css"]
  for (const family of SEED_FAMILIES) {
    const path = `templates/${family}.template.html`
    if (existsSync(resolvePath(PACKAGE_CORPUS, path))) roots.push(path)
  }
  for (const dir of ["language", "commands"]) {
    const full = resolvePath(PACKAGE_CORPUS, dir)
    if (!existsSync(full)) continue
    for (const file of walkFiles(full)) {
      if (file.endsWith(".html")) roots.push(relativePath(PACKAGE_CORPUS, file))
    }
  }

  const resolved = new Set(roots.map((path) => resolvePath(PACKAGE_CORPUS, path)))
  const queue = [...resolved]
  while (queue.length) {
    const full = /** @type {string} */ (queue.shift())
    if (!full.endsWith(".html")) continue
    for (const ref of localReferences(readFileSync(full, "utf8"), dirname(full))) {
      if (!resolved.has(ref)) {
        resolved.add(ref)
        queue.push(ref)
      }
    }
  }
  return [...resolved].map((full) => relativePath(PACKAGE_CORPUS, full)).sort()
}

/**
 * Repoints the links a seeded document carries out of the corpus it is leaving.
 *
 * A template cites the spec it came from and the entries behind its rules, all
 * by relative path. Those resolve here and nowhere else, so in a consumer they
 * would fail every-link-resolves on the first run — a gate red before anybody
 * has written anything, which teaches people to stop reading it.
 *
 * Which links to rewrite is derived rather than listed: anything resolving to a
 * file the seed does not carry gets the published site instead, and a link the
 * seed does carry keeps exactly what its author wrote. So adding a family to
 * the seed quietly stops rewriting the links that now resolve, and no list here
 * falls behind.
 * A <template> holds a schema rather than markup, so its own href is a regular
 * expression the validator tests an instance against. Nothing here may descend
 * into one: a pattern reading `.+` came back as a URL ending in `.+`, and every
 * instance then failed against a rule that had stopped describing a link.
 *
 * Hence a parse rather than a search over the text. parse5 hands back each
 * attribute's byte range, so the edits splice into the original and every other
 * byte of the document survives exactly as somebody wrote it.
 *
 * @param {string} html
 * @param {string} path
 * @param {Set<string>} carried
 * @returns {string}
 */
function repointOutwardLinks(html, path, carried) {
  /** @type {{start: number, end: number, text: string}[]} */
  const edits = []

  /** @param {any} node */
  function visit(node) {
    const tag = node.tagName?.toLowerCase()
    if (tag === "template") return
    for (const attribute of node.attrs ?? []) {
      if (attribute.name !== "href" && attribute.name !== "src") continue
      const value = /** @type {string} */ (attribute.value)
      if (!value || value.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(value)) continue
      const hash = value.indexOf("#")
      const target = hash === -1 ? value : value.slice(0, hash)
      const fragment = hash === -1 ? "" : value.slice(hash)
      const resolved = posix.normalize(posix.join(posix.dirname(path), target))
      if (carried.has(resolved)) continue
      const at = node.sourceCodeLocation?.attrs?.[attribute.name]
      if (!at) continue
      edits.push({
        start: at.startOffset,
        end: at.endOffset,
        text: `${attribute.name}="${PUBLISHED_SITE}${resolved}${fragment}"`,
      })
    }
    for (const child of node.childNodes ?? []) visit(child)
  }
  visit(parseHTMLWithLocations(html))

  let out = html
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}

/**
 * Every package a seeded rule declares, gathered from every
 * type="mycelium/importmap" script the seed just wrote.
 *
 * A rule's check runs against a real library, not a copy this package
 * carries — mycelium/retext tried that once and pinned every consumer to
 * whichever version this package happened to depend on. The dependency
 * belongs to the rule, so the rule installs it. mycelium/importmap rather
 * than a real type="importmap" because these values are semver ranges for
 * npm, not resolution targets a browser could act on.
 *
 * The script stays plain JSON rather than a real module, though. Reading it
 * is a JSON.parse, never an import, so it never runs through the
 * type-stripping module hook every other mycelium/* script loads through.
 * That hook fails on a real install, since this package's own corpus sits
 * inside node_modules there.
 *
 * package-manager-detector finds which manager the consumer already used to
 * install mycelium itself. A lockfile is already there by construction, so
 * detection needs no fallback of its own. That manager's own add command
 * then writes package.json and the lockfile, the same as if somebody had
 * typed it by hand.
 *
 * @param {string[]} paths
 * @param {string} repoRoot
 * @param {(line: string) => void} out
 * @returns {Promise<void>}
 */
async function installDependencies(paths, repoRoot, out) {
  /** @type {Map<string, string>} */
  const dependencies = new Map()
  for (const path of paths) {
    if (!path.endsWith(".html")) continue
    const filePath = resolvePath(PACKAGE_CORPUS, path)
    const { document } = parseHTML(readFileSync(filePath, "utf8"))
    for (const el of Array.from(document.querySelectorAll('script[type="mycelium/importmap"]'))) {
      const parsed = JSON.parse(el.textContent ?? "{}")
      for (const [name, version] of Object.entries(parsed.imports ?? {})) {
        dependencies.set(name, /** @type {string} */ (version))
      }
    }
  }
  if (dependencies.size === 0) return

  const specs = [...dependencies].map(([name, version]) => `${name}@${version}`)
  const pm = await detect({ cwd: repoRoot })
  if (!pm) {
    out(`A seeded rule needs: ${specs.join(", ")} — no package manager detected, add them yourself.`)
    return
  }
  const resolved = resolveCommand(pm.agent, "add", specs)
  if (!resolved) {
    out(`A seeded rule needs: ${specs.join(", ")} — ${pm.agent} has no add command, add them yourself.`)
    return
  }
  out(`installing ${specs.join(" ")} with ${resolved.command} ${resolved.args.join(" ")}`)
  spawnSync(resolved.command, resolved.args, { cwd: repoRoot, stdio: "inherit" })
}

/**
 * Writes a corpus where none exists, and reports every file it wrote.
 *
 * This is the one thing the engine knows that is not the protocol, and it has
 * to be: a command lives inside a document, so no command can put the first
 * documents there. Everything it knows is still a path to copy, never anything
 * about what the copied documents mean.
 *
 * Returns false when a corpus is already there, because running this a second
 * time must not overwrite whatever somebody has written since the first.
 *
 * @param {string} target
 * @param {(line: string) => void} out
 * @returns {Promise<boolean>}
 */
async function seedCorpus(target, out) {
  if (existsSync(target)) return false

  const paths = seedPaths()
  const carried = new Set(paths)
  for (const path of paths) {
    const from = resolvePath(PACKAGE_CORPUS, path)
    const to = resolvePath(target, path)
    mkdirSync(dirname(to), { recursive: true })
    if (path.endsWith(".html")) writeFileSync(to, repointOutwardLinks(readFileSync(from, "utf8"), path, carried))
    else copyFileSync(from, to)
    out(`wrote    ${join(CORPUS_DIR, path)}`)
  }
  out("")
  out(`A corpus is now at ${CORPUS_DIR}/. Commit it: an instance names its own`)
  out("template by relative path, so the templates belong beside what conforms to them.")
  out("")
  await installDependencies(paths, dirname(target), out)
  return true
}

/**
 * @param {string[]} argv
 * @returns {ParsedArgs}
 */
function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith("--")) {
      const key = token.slice(2)
      const next = argv[i + 1]
      // A flag before another flag, or at the end, takes no value.
      const value = next === undefined || next.startsWith("--") ? "true" : (i++, next)
      // A flag given twice collects rather than overwrites: --tag a --tag b means both.
      const seen = args[key]
      args[key] = seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
    } else {
      args._.push(token)
    }
  }
  return args
}

/**
 * The write side of the fs.get/fs.create/fs.delete contract: a command
 * mutates the Document objects handed to it, in place, and never returns
 * anything. Everything touched gets serialized and written (or removed,
 * for deletes) once the command function has finished running — the same
 * three operations regardless of what the command did internally.
 *
 * get()/create() snapshot each document's serialized HTML the moment it's
 * parsed; commit() re-serializes and compares against that snapshot before
 * writing, skipping any file the command read but never actually mutated.
 * Both snapshots go through the same happy-dom serialization path, so
 * parse/reserialize formatting noise cancels out on both sides — the only
 * way they can differ is a real change in between. This is what makes
 * list() (below) safe to call on dozens of files just to read them.
 *
 * happy-dom's parse/serialize round-trip inflates whitespace-only text
 * nodes, and it compounds on every write. Normalized on the DOM rather
 * than on the serialized string: at that layer "formatting or content?"
 * is not a guess, because a whitespace-only text node is formatting by
 * definition — unless it sits inside <pre>, where every byte is content.
 * An earlier string-level version collapsed blank lines everywhere and
 * silently rewrote transcribed code, taking every paragraph break out of
 * a 67-line block while leaving it byte-faithful otherwise.
 *
 * Runs before both serializations, like indentRootChildren, so the
 * unchanged-file comparison still cancels out.
 *
 * @param {Node} node
 * @param {boolean} [inPre]
 * @returns {void}
 */
function collapseFormattingWhitespace(node, inPre = false) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? ""
      if (!inPre && text.trim() === "") child.textContent = text.replace(/\n{2,}/g, "\n")
      continue
    }
    const tag = /** @type {Element} */ (child).tagName?.toLowerCase()
    collapseFormattingWhitespace(child, inPre || tag === "pre")
  }
}

/**
 * A script element holds raw text, and a parser ends one at the first closing
 * tag inside that text. So a script whose content mentions its own closing tag
 * serializes into a document that no longer parses back: the content truncates
 * there and the rest becomes stray markup beside the element.
 *
 * A check building an HTML fixture writes exactly that content, and the fault
 * arrives at write time with nothing to see. This project produced it twice in
 * one afternoon — once from a fixture and once from a comment describing the
 * problem.
 *
 * Which nodes to fix comes from the tree rather than from a search over the
 * text. The document says which elements hold raw text, and only their own
 * content changes; the escape is valid wherever it lands, since a backslash
 * before the slash reads as itself in a string, a regular expression and a
 * comment alike.
 *
 * @param {Document} doc
 * @returns {void}
 */
function escapeRawText(doc) {
  for (const element of Array.from(doc.querySelectorAll("script, style"))) {
    const text = element.textContent ?? ""
    const closing = `</${element.tagName.toLowerCase()}`
    if (text.includes(closing)) element.textContent = text.split(closing).join(`<\\/${element.tagName.toLowerCase()}`)
  }
}

/**
 * @param {Document} doc
 * @returns {string}
 */
function serialize(doc) {
  collapseFormattingWhitespace(/** @type {Element} */ (doc.documentElement))
  escapeRawText(doc)
  return /** @type {Element} */ (doc.documentElement).outerHTML
}

/**
 * Reindents every data-conforms-to element's direct children with
 * consistent 2-space-per-level indentation, matching this project's own
 * hand-authored style. Plain appendChild() — what every command's
 * field()-style helper does — leaves every field butted up against its
 * neighbor with no whitespace at all. It strips any existing whitespace-only
 * text children first and rebuilds from scratch, so it is safe to call more
 * than once on the same document.
 *
 * get() calls it once for the comparison snapshot; commit() calls it again
 * as the last step before writing, after whatever a command did to the
 * tree in between.
 *
 * Most families (knowledge-*, spec-doc) only ever have one conforming
 * element per document, so this used to look for a single root.
 *
 * plan-* nests conforming types three deep (plan-doc > plan-task >
 * plan-step > plan-check), so this now reindents every [data-conforms-to]
 * element in the document independently. Each sits at a depth based on how many
 * *other conforming elements* contain it — not raw DOM ancestors, so
 * <html>/<head>/<body> don't count. A top-level root (depth 0) gets
 * exactly the indentation this function has always produced; a nested one
 * gets indented two spaces deeper per level of conforming-element nesting.
 *
 * Still reformats one level only, per element — this leaves anything nested
 * inside a non-conforming child (e.g. knowledge-detail's or plan-detail's
 * own arbitrary markup) exactly as authored, since reformatting arbitrary
 * nested content risks corrupting significant whitespace inside
 * <pre>/<script>.
 *
 * @param {Document} doc
 * @returns {void}
 */
function indentRootChildren(doc) {
  const roots = Array.from(doc.querySelectorAll("[data-conforms-to]"))

  /** @param {Element} el @returns {number} */
  const depthOf = (el) => {
    let depth = 0
    let cur = el.parentElement
    while (cur) {
      if (cur.hasAttribute("data-conforms-to")) depth++
      cur = cur.parentElement
    }
    return depth
  }

  // Deepest first, so a parent's own re-indentation doesn't shift a nested child before it's processed.
  roots.sort((a, b) => depthOf(b) - depthOf(a))

  for (const root of roots) {
    const depth = depthOf(root)
    const indent = "  ".repeat(depth + 1)
    const closeIndent = "  ".repeat(depth)
    for (const node of Array.from(root.childNodes)) {
      if (node.nodeType === 3 && !node.textContent?.trim()) node.remove()
    }
    const children = Array.from(root.children)
    for (const el of children) root.insertBefore(doc.createTextNode(`\n${indent}`), el)
    if (children.length > 0) root.appendChild(doc.createTextNode(`\n${closeIndent}`))
  }
}

/** @typedef {{doc: Document, original: string} | {deleted: true}} TouchedEntry */

class Filesystem {
  /** @type {string} */
  #root
  /** @type {Map<string, TouchedEntry>} */
  #touched = new Map()

  /** @param {string} root */
  constructor(root) {
    this.#root = root
  }

  /**
   * A command that has to hand a real file path to something else needs to
   * resolve one, and every path this class takes or returns is relative to
   * this root. AuditFs has exposed the same thing all along; this is the
   * read side of it, so a command can do the arithmetic an audit already can.
   *
   * @returns {string}
   */
  get root() {
    return this.#root
  }

  /** @param {string} path @returns {Document} */
  get(path) {
    const full = resolvePath(this.#root, path)
    let entry = this.#touched.get(full)
    if (!entry) {
      const html = readFileSync(full, "utf8")
      const { document } = parseHTML(html)
      const doc = /** @type {Document} */ (/** @type {unknown} */ (document))
      indentRootChildren(doc)
      entry = { doc, original: serialize(doc) }
      this.#touched.set(full, entry)
    }
    if (!("doc" in entry)) throw new Error(`${path} was already deleted`)
    return entry.doc
  }

  /** @param {string} path @param {string} seedHtml @returns {Document} */
  create(path, seedHtml) {
    const full = resolvePath(this.#root, path)
    const { document } = parseHTML(seedHtml)
    // No "original" snapshot matches a real serialization, so a created file is always written.
    this.#touched.set(full, { doc: /** @type {Document} */ (/** @type {unknown} */ (document)), original: "" })
    return /** @type {Document} */ (/** @type {unknown} */ (document))
  }

  /** @param {string} path @returns {void} */
  delete(path) {
    const full = resolvePath(this.#root, path)
    this.#touched.set(full, { deleted: true })
  }

  /**
   * Whether a path will be there once this run's writes land, which is not the
   * same question as what sits on disk right now. A command that deletes a file
   * and then asks about it gets the answer its own run produced, so a migration
   * walking the corpus it is halfway through rewriting sees that corpus rather
   * than the one it started from.
   *
   * @param {string} path
   * @returns {boolean}
   */
  exists(path) {
    const entry = this.#touched.get(resolvePath(this.#root, path))
    if (entry) return !("deleted" in entry)
    return existsSync(resolvePath(this.#root, path))
  }

  /**
   * Reads every .html file under dir (relative to this Filesystem's root)
   * via get(), so every file it returns is tracked the same way a single
   * get() call would be — no separate read-only path, no separate tracking.
   *
   * @param {string} dir
   * @returns {{path: string, doc: Document}[]}
   */
  list(dir) {
    const full = resolvePath(this.#root, dir)
    return walkHtmlFiles(full)
      .map((file) => relativePath(this.#root, file))
      // Filtered through exists(), not the disk, so a deleted/created file this run reads right.
      .filter((path) => this.exists(path))
      .map((path) => ({ path, doc: this.get(path) }))
  }

  /**
   * Calling this twice writes nothing the second time, which is what lets a
   * command flush partway through. A probe becomes a module addressed by its
   * own file and the loader reads that file, so a command creating an
   * experiment has to put it on disk before it can run one. Without this, the
   * engine's own commit afterwards would rewrite every file and log every line
   * again, and a second pass over a deleted document would throw.
   *
   * @returns {string[]}
   */
  commit() {
    /** @type {string[]} */
    const written = []
    for (const [full, entry] of this.#touched) {
      const label = relativePath(this.#root, full)
      if ("deleted" in entry) {
        unlinkSync(full)
        console.log(`deleted  ${label}`)
        this.#touched.delete(full)
        continue
      }
      indentRootChildren(entry.doc)
      const html = serialize(entry.doc)
      if (html === entry.original) continue
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, "<!DOCTYPE html>\n" + html + "\n")
      console.log(`wrote    ${label}`)
      written.push(full)
      // What's on disk is now the original, so a later pass compares against that, not the pre-command state.
      entry.original = html
    }
    return written
  }
}

/**
 * Every command script is TypeScript — a type-only import at the top, a
 * CommandContext annotation on every exported function's parameter. So
 * this is parsed with the real TypeScript compiler rather than a JavaScript
 * parser that would have to strip types first. ScriptKind.TSX is a strict
 * superset of what a command script actually contains; see
 * .mycelium/templates/code-comments.ts for why that is safe here.
 *
 * @param {string} source
 * @returns {ts.SourceFile}
 */
function parseCommandSource(source) {
  return ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
}

/**
 * @param {string} raw
 * @returns {string}
 */
function formatComment(raw) {
  return raw
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)))
    .join("\n")
}

// Max length for firstSentence's own collapsed output.
const SUMMARY_MAX = 76

/**
 * @param {string} doc
 * @returns {string}
 */
function firstSentence(doc) {
  /** @type {string[]} */
  const lines = []
  for (const line of doc.split("\n")) {
    if (!line.trim()) break
    lines.push(line.trim())
  }
  const paragraph = lines.join(" ")
  // A period only counts followed by a space or end, not any dot (e.g. inside "docs/").
  const end = /\.(\s|$)/.exec(paragraph)
  const sentence = end ? paragraph.slice(0, end.index + 1) : paragraph
  return sentence.length > SUMMARY_MAX ? sentence.slice(0, SUMMARY_MAX - 1).trimEnd() + "…" : sentence
}

// readCommands lives in shared.ts, so a roster and --help never drift apart.

/**
 * One line per command across every family, so no command can be invisible
 * to someone who never thought to ask for the family it lives in. The point
 * is the NAMES: a reader who knows `unlink` exists can get its flags from
 * `<id> --help`, but a reader who doesn't concludes the capability is
 * missing. That is what happened when a hand-maintained list in CLAUDE.md
 * fell three commands behind what the CLI exports. Nobody maintains this
 * by hand; printRoster reads it straight off the same command scripts the
 * engine runs.
 *
 * The corpus's own claim about itself, read fresh rather than repeated in a
 * string the corpus does not own. The root canon declares its axioms in
 * document order, and the first one is the closest thing this project has
 * to an opening sentence.
 *
 * @param {string} docsDir
 * @returns {string | null}
 */
function firstRootAxiomTitle(docsDir) {
  const path = join(docsDir, "canon", "root.canon.html")
  if (!existsSync(path)) return null
  const { document } = parseHTML(readFileSync(path, "utf8"))
  const title = document.querySelector("canon-axiom > canon-title")
  return title?.textContent?.trim() || null
}

/**
 * A host's own description of itself, declared once and read here rather than
 * written a second time. Purpose is not shortened: a title that gets
 * truncated is a title whose own length limit failed at its one job.
 *
 * @param {string} file
 * @returns {string}
 */
function hostPurpose(file) {
  const { document } = parseHTML(readFileSync(file, "utf8"))
  const purpose = document.querySelector("template-host > template-purpose")
  return purpose?.textContent?.replace(/\s+/g, " ").trim() ?? ""
}

/**
 * How many documents conform to each host, walked once for every host at
 * once. A document declaring a template of its own is documentation about a
 * type rather than a claim, so it is skipped here exactly as it is
 * everywhere else that reads data-conforms-to — a template file's own
 * template-host included.
 *
 * @param {string} docsDir
 * @param {string[]} hostIds
 * @returns {Map<string, number>}
 */
function countInstancesPerHost(docsDir, hostIds) {
  const counts = new Map(hostIds.map((id) => [id, 0]))
  for (const file of walkHtmlFiles(docsDir)) {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    if (document.querySelector("template[id]")) continue
    /** @type {Set<string>} */
    const seen = new Set()
    for (const el of Array.from(document.querySelectorAll("[data-conforms-to]"))) {
      const conformsTo = el.getAttribute("data-conforms-to") ?? ""
      seen.add(basename(conformsTo).replace(/\.(template|command)\.html.*$/, ""))
    }
    for (const id of seen) if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

/**
 * A file is a command host only if its name ends in one of
 * TEMPLATE_FILE_SUFFIXES, the same rule findTemplateFile uses to resolve an
 * <id>. That matters beyond consistency: specs and plans QUOTE command
 * scripts in escaped code blocks. A scan that went looking for the
 * <script> tag alone would find a dozen frozen copies of older versions of
 * these same commands and list them as real.
 *
 * Everything this prints is derived rather than repeated. The opening line
 * is the corpus's own first root axiom. A host's purpose comes from the
 * template-host it now declares. A count comes from walking data-conforms-to
 * the same way explore list does.
 *
 * A session meeting this project should leave this one screen able to name
 * every family, what each is for, how much of the corpus lives there, and
 * every command it can run. Not a teaser it then has to spend a second
 * command finding the rest of.
 *
 * @param {string} docsDir
 * @param {(line: string) => void} stream
 */
function printRoster(docsDir, stream) {
  const opening = firstRootAxiomTitle(docsDir)
  const sentence = opening ? opening[0].toLowerCase() + opening.slice(1).replace(/\.$/, "") : "the documents are the source of truth"
  stream(`mycelium — ${sentence}.`)
  stream("")
  stream("usage: mycelium <id> <command> [args…]")
  stream("       mycelium <id> --help          every flag and caveat for one family")
  stream("")

  const hosts = walkHtmlFiles(docsDir)
    .filter((file) => TEMPLATE_FILE_SUFFIXES.some((suffix) => file.endsWith(`.${suffix}`)))
    .map((file) => ({ id: basename(file).replace(/\.(template|command)\.html$/, ""), file }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const counts = countInstancesPerHost(docsDir, hosts.map((host) => host.id))

  for (const { id, file } of hosts) {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    const count = counts.get(id) ?? 0
    stream(`${id}  ${count ? `${count} docs` : "no docs"}  (${relativePath(docsDir, file)})`)
    const purpose = hostPurpose(file)
    if (purpose) stream(`  ${purpose}`)

    const script = document.querySelector('script[type="mycelium/command"]')
    if (!script) {
      stream("")
      continue
    }

    // A host this can't read names itself broken and moves on, not taking every family down with it.
    /** @type {CommandEntry[]} */
    let commands
    try {
      commands = readCommands(script.textContent ?? "")
    } catch (err) {
      stream(`  (unreadable: ${/** @type {Error} */ (err).message})`)
      stream("")
      continue
    }
    if (commands.length === 0) {
      stream("")
      continue
    }

    stream("")
    const labels = commands.map((c) => c.path.join(" "))
    const width = Math.max(...labels.map((l) => l.length))
    for (const [index, { summary }] of commands.entries()) stream(`  ${labels[index].padEnd(width + 2)}${summary}`.trimEnd())
    stream("")
  }
}

/**
 * Every block comment anywhere in the file, in source order. An audit's own
 * description sits after its imports rather than at the very top of the
 * file, so finding only the trivia leading the first token would miss it.
 * This walks every node instead, the same way code-comments.ts does for a
 * rule checking a script's prose.
 *
 * @param {string} source
 * @param {ts.SourceFile} sourceFile
 * @returns {{pos: number, raw: string}[]}
 */
function allBlockComments(source, sourceFile) {
  /** @type {Set<number>} */
  const seen = new Set()
  /** @type {{pos: number, raw: string}[]} */
  const found = []
  /**
   * @param {number} pos
   * @param {number} end
   * @param {ts.CommentKind} kind
   */
  function record(pos, end, kind) {
    if (kind !== ts.SyntaxKind.MultiLineCommentTrivia || seen.has(pos)) return
    seen.add(pos)
    found.push({ pos, raw: source.slice(pos, end) })
  }
  /** @param {ts.Node} node */
  function visit(node) {
    ts.forEachLeadingCommentRange(source, node.getFullStart(), record)
    ts.forEachTrailingCommentRange(source, node.getEnd(), record)
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return found.sort((a, b) => a.pos - b.pos)
}

/**
 * The leading doc comment of a script that is one module rather than a set of
 * exports. An audit is a single check, so its description sits at the top of
 * the file instead of above an export, and readCommands would not find it.
 *
 * @param {string} source
 * @returns {string}
 */
function leadingComment(source) {
  const sourceFile = parseCommandSource(source)
  const first = allBlockComments(source, sourceFile)[0]
  return first ? firstSentence(formatComment(first.raw)) : ""
}

/**
 * Every audit declared anywhere in the corpus, with what it holds true. Audits
 * are the other half of what this tool does, and listing only commands is how
 * one of them stayed invisible long enough for someone to write a writing
 * rule duplicating it by hand.
 *
 * @param {string} docsDir
 * @param {(line: string) => void} stream
 */
function printAudits(docsDir, stream) {
  /** @type {{name: string, touches: string, summary: string, file: string}[]} */
  const found = []
  for (const file of walkHtmlFiles(docsDir)) {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    for (const script of Array.from(document.querySelectorAll("script[data-audits]"))) {
      found.push({
        name: /** @type {string} */ (script.getAttribute("data-audits")),
        touches: script.getAttribute("data-touches") ?? "",
        summary: leadingComment(script.textContent ?? ""),
        file: relativePath(docsDir, file),
      })
    }
  }
  if (found.length === 0) return
  stream("audits  (run by `mycelium validate`; any failure exits non-zero)")
  const width = Math.max(...found.map((a) => a.name.length))
  for (const audit of found.sort((a, b) => a.name.localeCompare(b.name))) {
    stream(`  ${audit.name.padEnd(width + 2)}${audit.summary}`.trimEnd())
    // Collapsed to a shared prefix when every touched type has one, purely by string structure.
    const parts = audit.touches.trim().split(/\s+/).filter(Boolean)
    const prefixes = new Set(parts.map((t) => t.split("-")[0]))
    const touches = parts.length > 1 && prefixes.size === 1 ? `${[...prefixes][0]}-*` : audit.touches
    if (touches) stream(`  ${" ".repeat(width + 2)}touches ${touches}`)
  }
  stream("")
}

/**
 * @param {string} id
 * @param {string} templateLabel
 * @param {string} source
 * @param {(line: string) => void} stream
 */
function printHelp(id, templateLabel, source, stream) {
  const commands = readCommands(source)
  stream(`commands for "${id}" (${templateLabel}):\n`)
  for (const { path, doc } of commands) {
    stream(`  ${path.join(" ")}`)
    stream(doc ? doc.split("\n").map((l) => `    ${l}`.trimEnd()).join("\n") : "    (no JSDoc comment)")
    stream("")
  }
}

/**
 * Node reports a closed downstream pipe as an 'error' event on stdout rather
 * than killing the process with SIGPIPE the way a C program would. So any
 * command printing more lines than `head` or `less` asks for dies with an
 * unhandled EPIPE instead of stopping quietly. Commands that stream (list,
 * and anything else printing per-node output) are exactly the ones people
 * pipe. Only EPIPE is swallowed; every other stdout error still throws.
 */
function exitQuietlyOnClosedPipe() {
  process.stdout.on("error", (/** @type {NodeJS.ErrnoException} */ err) => {
    if (err.code === "EPIPE") process.exit(0)
    throw err
  })
}

async function main() {
  exitQuietlyOnClosedPipe()
  const [id, namedCommand, ...rest] = process.argv.slice(2)
  const docsDir = resolvePath(CORPUS_DIR)

  // A SessionStart hook reads stdout for the roster; bad-invocation help goes to stderr instead.
  /** @param {string} line */
  const out = (line) => console.log(line)
  /** @param {string} line */
  const err = (line) => console.error(line)

  // Bare name seeds if needed, then prints; a second run only prints.
  if (!id) {
    await seedCorpus(docsDir, out)
    if (!existsSync(docsDir)) {
      out(`No corpus here yet. Run \`mycelium\` with nothing after it to write one into ${CORPUS_DIR}/.`)
      process.exit(0)
    }
    printRoster(docsDir, out)
    printAudits(docsDir, out)
    process.exit(0)
  }

  // Every command needs a corpus, so say so here rather than let each one fail on its own missing path.
  if (!existsSync(docsDir)) {
    console.error(`no corpus at ${CORPUS_DIR}/ — run \`mycelium\` with nothing after it to write one`)
    process.exit(1)
  }

  const templateFile = findTemplateFile(docsDir, id)
  if (!templateFile) {
    console.error(
      `no command host found for "${id}" (looked for ${id}.template.html or ${id}.command.html) — ` +
        "run `mycelium` with nothing after it to see every family and command",
    )
    process.exit(1)
  }
  const templateLabel = relativePath(docsDir, /** @type {string} */ (templateFile))

  const { document } = parseHTML(readFileSync(/** @type {string} */ (templateFile), "utf8"))
  const script = document.querySelector('script[type="mycelium/command"]')
  if (!script) {
    console.error(`${templateLabel} has no <script type="mycelium/command">`)
    process.exit(1)
  }

  const source = /** @type {Element} */ (script).textContent ?? ""
  const mod = await loadModule(/** @type {string} */ (templateFile), /** @type {Element} */ (script))

  // A default export skips repeating the host's own name: `mycelium validate`, not `validate validate`.
  const isHelp = namedCommand === "--help" || namedCommand === "-h"
  const useDefault =
    typeof mod.default === "function" && !isHelp && (!namedCommand || namedCommand.startsWith("-"))
  const command = useDefault ? "default" : namedCommand
  const commandArgs = useDefault && namedCommand ? [namedCommand, ...rest] : rest

  if (!command || command === "--help" || command === "-h") {
    printHelp(id, templateLabel, source, command ? out : err)
    process.exit(command ? 0 : 1)
  }

  const top = /** @type {unknown} */ (mod[command])
  if (typeof top !== "function" && (typeof top !== "object" || top === null)) {
    console.error(`${templateLabel} has no "${command}" command\n`)
    printHelp(id, templateLabel, source, err)
    process.exit(1)
  }

  const args = parseArgs(commandArgs)

  // Both args are paths from the docs root; a sibling/descendant target gets a "./" prefix.
  /** @type {Cli["href"]} */
  const href = (from, to) => {
    const path = relativePath(dirname(resolvePath(docsDir, from)), resolvePath(docsDir, to))
    return path.startsWith(".") ? path : `./${path}`
  }

  /** @type {Validate} */
  const validate = (root, instancePath) => validateInstance(docsDir, instancePath, root)
  /** @type {Cli} */
  const cli = { validate, readStdin, parseHTML, href }

  const fs = new Filesystem(docsDir)
  try {
    // A resolved export is the command itself or a table of further verbs to descend into.
    /** @type {unknown} */
    let current = top
    const verbPath = [id, command]
    while (typeof current === "object" && current !== null) {
      const verb = args._[0]
      const table = /** @type {Record<string, unknown>} */ (current)
      const next = verb !== undefined ? table[verb] : undefined
      if (verb === undefined || (typeof next !== "function" && (typeof next !== "object" || next === null))) {
        const keys = Object.keys(table).join(", ")
        throw new Error(
          verb
            ? `${verbPath.join(" ")} has no "${verb}" verb; it takes ${keys}`
            : `${verbPath.join(" ")} takes a verb: ${keys}`,
        )
      }
      current = next
      verbPath.push(verb)
      args._ = args._.slice(1)
    }
    await (/** @type {(ctx: CommandContext) => void | Promise<void>} */ (current))({ fs, args, cli })
    fs.commit()
  } catch (err) {
    console.error(/** @type {Error} */ (err).message)
    process.exit(1)
  }
}

main()
