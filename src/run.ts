// mycelium <id> <command> [args…]. Protocol-only: the engine knows
// <template>, data-conforms-to, and how to find the one
// script[type="mycelium/command"] a template file declares — never what any
// command, validate included, actually does. See
// .mycelium/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { basename, dirname, join, posix, relative as relativePath, resolve as resolvePath } from "node:path"
import { register } from "node:module"
import ts from "typescript"
import { CORPUS_DIR, parseHTML, parseHTMLWithLocations, walkFiles, walkHtmlFiles, validateInstance, readStdin, loadModule } from "./utils.ts"

register("./script-hooks.ts", import.meta.url)

// The shapes a command is handed now live in api.ts, so a command embedded in
// a template document can import the same declaration the engine builds
// against instead of destructuring an implicit any.
import type { Cli, CommandContext, ParsedArgs, Validate } from "./api.ts"

export type { Cli, CommandContext, ParsedArgs, Validate }

// A command host is either a content family's own <id>.template.html,
// whose instances conform to it via data-conforms-to, or a singleton
// <id>.command.html with no instances of its own. The latter is a
// whole-corpus tool, like .mycelium/commands/explore.command.html.
// findTemplateFile finds both the same way, searching in that order so a
// family template always wins a name clash.
const TEMPLATE_FILE_SUFFIXES = ["template.html", "command.html"]

function findTemplateFile(dir: string, id: string): string | null {
  const files = walkHtmlFiles(dir)
  for (const suffix of TEMPLATE_FILE_SUFFIXES) {
    const target = `${id}.${suffix}`
    const found = files.find((f) => f.endsWith(`/${target}`))
    if (found) return found
  }
  return null
}

// Where this package's own corpus sits, whether it is running from a checkout
// or from node_modules. Both look the same from here, which is what lets a
// consumer's seed come out of the same documents this project validates.
const PACKAGE_CORPUS = resolvePath(import.meta.dirname, "..", CORPUS_DIR)

// Where a seeded document's outward links point once they leave this
// repository. The canon holds that an entry may only refer to what a reader can
// open, and a live external link satisfies that where a relative one into a
// corpus the consumer does not have cannot.
const PUBLISHED_SITE = "https://bigmistqke.github.io/mycelium/"

// The families a new corpus starts with, and nothing more. A template has to be
// copied because every instance names it by relative path and the audit opens
// that path; a family nobody has authored against yet has no such instance, so
// it can wait until somebody wants it.
//
// canon, spec, plan and figure stay out for that reason rather than as a
// judgement about them. Adding one is a line here plus whatever it names.
const SEED_FAMILIES = ["template", "notebook", "language", "followup"]

// Every file a fresh corpus gets, as paths relative to the corpus root.
//
// Only documents and their stylesheets. Nothing in the corpus names a .ts
// helper beside a template, because a script imports it rather than linking to
// it, so the package keeps the single copy. An .element.js goes the same way,
// since the generated graph page inlines it from wherever the reading code sits.
function seedPaths(): string[] {
  const paths: string[] = ["theme.css"]
  for (const family of SEED_FAMILIES) {
    for (const suffix of ["html", "css"]) {
      const path = `templates/${family}.template.${suffix}`
      if (existsSync(resolvePath(PACKAGE_CORPUS, path))) paths.push(path)
    }
  }
  for (const dir of ["language", "commands"]) {
    const full = resolvePath(PACKAGE_CORPUS, dir)
    if (!existsSync(full)) continue
    for (const file of walkFiles(full)) {
      if (file.endsWith(".html")) paths.push(relativePath(PACKAGE_CORPUS, file))
    }
  }
  return paths
}

// Repoints the links a seeded document carries out of the corpus it is leaving.
//
// A template cites the spec it came from and the entries behind its rules, all
// by relative path. Those resolve here and nowhere else, so in a consumer they
// would fail every-link-resolves on the first run — a gate red before anybody
// has written anything, which teaches people to stop reading it.
//
// Which links to rewrite is derived rather than listed: anything resolving to a
// file the seed does not carry gets the published site instead, and a link the
// seed does carry keeps exactly what its author wrote. So adding a family to
// the seed quietly stops rewriting the links that now resolve, and no list here
// falls behind.
// A <template> holds a schema rather than markup, so its own href is a regular
// expression the validator tests an instance against. Nothing here may descend
// into one: a pattern reading `.+` came back as a URL ending in `.+`, and every
// instance then failed against a rule that had stopped describing a link.
//
// Hence a parse rather than a search over the text. parse5 hands back each
// attribute's byte range, so the edits splice into the original and every other
// byte of the document survives exactly as somebody wrote it.
function repointOutwardLinks(html: string, path: string, carried: Set<string>): string {
  const edits: { start: number; end: number; text: string }[] = []

  function visit(node: any) {
    const tag = node.tagName?.toLowerCase()
    if (tag === "template") return
    for (const attribute of node.attrs ?? []) {
      if (attribute.name !== "href" && attribute.name !== "src") continue
      const value = attribute.value as string
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

// Writes a corpus where none exists, and reports every file it wrote.
//
// This is the one thing the engine knows that is not the protocol, and it has
// to be: a command lives inside a document, so no command can put the first
// documents there. Everything it knows is still a path to copy, never anything
// about what the copied documents mean.
//
// Returns false when a corpus is already there, because running this a second
// time must not overwrite whatever somebody has written since the first.
function seedCorpus(target: string, out: (line: string) => void): boolean {
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
  return true
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith("--")) {
      const key = token.slice(2)
      const next = argv[i + 1]
      // A flag with nothing after it, or with another flag right after it,
      // takes no value — --diff, say, rather than --diff <something>. Every
      // flag this project had until now took a value, so this only ever
      // widens what already parsed the same way.
      const value = next === undefined || next.startsWith("--") ? "true" : (i++, next)
      // A flag given twice collects rather than overwrites, so `--tag a --tag b`
      // means both. One use still yields a plain string, so every command
      // reading a flag as one is untouched; only repeating a flag changes, and
      // repeating one used to silently discard everything but the last value.
      const seen = args[key]
      args[key] = seen === undefined ? value : Array.isArray(seen) ? [...seen, value] : [seen, value]
    } else {
      args._.push(token)
    }
  }
  return args
}

// The write side of the fs.get/fs.create/fs.delete contract: a command
// mutates the Document objects handed to it, in place, and never returns
// anything. Everything touched gets serialized and written (or removed,
// for deletes) once the command function has finished running — the same
// three operations regardless of what the command did internally.
//
// get()/create() snapshot each document's serialized HTML the moment it's
// parsed; commit() re-serializes and compares against that snapshot before
// writing, skipping any file the command read but never actually mutated.
// Both snapshots go through the same happy-dom serialization path, so
// parse/reserialize formatting noise cancels out on both sides — the only
// way they can differ is a real change in between. This is what makes
// list() (below) safe to call on dozens of files just to read them.
//
// happy-dom's parse/serialize round-trip inflates whitespace-only text
// nodes, and it compounds on every write. Normalized on the DOM rather
// than on the serialized string: at that layer "formatting or content?"
// is not a guess, because a whitespace-only text node is formatting by
// definition — unless it sits inside <pre>, where every byte is content.
// An earlier string-level version collapsed blank lines everywhere and
// silently rewrote transcribed code, taking every paragraph break out of
// a 67-line block while leaving it byte-faithful otherwise.
//
// Runs before both serializations, like indentRootChildren, so the
// unchanged-file comparison still cancels out.
function collapseFormattingWhitespace(node: Node, inPre = false): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent ?? ""
      if (!inPre && text.trim() === "") child.textContent = text.replace(/\n{2,}/g, "\n")
      continue
    }
    const tag = (child as Element).tagName?.toLowerCase()
    collapseFormattingWhitespace(child, inPre || tag === "pre")
  }
}

// A script element holds raw text, and a parser ends one at the first closing
// tag inside that text. So a script whose content mentions its own closing tag
// serializes into a document that no longer parses back: the content truncates
// there and the rest becomes stray markup beside the element.
//
// A check building an HTML fixture writes exactly that content, and the fault
// arrives at write time with nothing to see. This project produced it twice in
// one afternoon — once from a fixture and once from a comment describing the
// problem.
//
// Which nodes to fix comes from the tree rather than from a search over the
// text. The document says which elements hold raw text, and only their own
// content changes; the escape is valid wherever it lands, since a backslash
// before the slash reads as itself in a string, a regular expression and a
// comment alike.
function escapeRawText(doc: Document): void {
  for (const element of Array.from(doc.querySelectorAll("script, style"))) {
    const text = element.textContent ?? ""
    const closing = `</${element.tagName.toLowerCase()}`
    if (text.includes(closing)) element.textContent = text.split(closing).join(`<\\/${element.tagName.toLowerCase()}`)
  }
}

function serialize(doc: Document): string {
  collapseFormattingWhitespace(doc.documentElement!)
  escapeRawText(doc)
  return doc.documentElement!.outerHTML
}

// Reindents every data-conforms-to element's direct children with
// consistent 2-space-per-level indentation, matching this project's own
// hand-authored style. Plain appendChild() — what every command's
// field()-style helper does — leaves every field butted up against its
// neighbor with no whitespace at all. It strips any existing whitespace-only
// text children first and rebuilds from scratch, so it is safe to call more
// than once on the same document.
//
// get() calls it once for the comparison snapshot; commit() calls it again
// as the last step before writing, after whatever a command did to the
// tree in between.
//
// Most families (knowledge-*, spec-doc) only ever have one conforming
// element per document, so this used to look for a single root.
//
// plan-* nests conforming types three deep (plan-doc > plan-task >
// plan-step > plan-check), so this now reindents every [data-conforms-to]
// element in the document independently. Each sits at a depth based on how many
// *other conforming elements* contain it — not raw DOM ancestors, so
// <html>/<head>/<body> don't count. A top-level root (depth 0) gets
// exactly the indentation this function has always produced; a nested one
// gets indented two spaces deeper per level of conforming-element nesting.
//
// Still reformats one level only, per element — this leaves anything nested
// inside a non-conforming child (e.g. knowledge-detail's or plan-detail's
// own arbitrary markup) exactly as authored, since reformatting arbitrary
// nested content risks corrupting significant whitespace inside
// <pre>/<script>.
function indentRootChildren(doc: Document): void {
  const roots = Array.from(doc.querySelectorAll("[data-conforms-to]"))

  const depthOf = (el: Element): number => {
    let depth = 0
    let cur = el.parentElement
    while (cur) {
      if (cur.hasAttribute("data-conforms-to")) depth++
      cur = cur.parentElement
    }
    return depth
  }

  // Deepest first, so a parent's own re-indentation (inserting whitespace
  // text nodes as its children) doesn't shift the position of a nested
  // [data-conforms-to] child before that child has already been
  // processed relative to ITS OWN children.
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

class Filesystem {
  #root: string
  #touched = new Map<string, { doc: Document; original: string } | { deleted: true }>()

  constructor(root: string) {
    this.#root = root
  }

  // A command that has to hand a real file path to something else needs to
  // resolve one, and every path this class takes or returns is relative to
  // this root. AuditFs has exposed the same thing all along; this is the
  // read side of it, so a command can do the arithmetic an audit already can.
  get root(): string {
    return this.#root
  }

  get(path: string): Document {
    const full = resolvePath(this.#root, path)
    let entry = this.#touched.get(full)
    if (!entry) {
      const html = readFileSync(full, "utf8")
      const { document } = parseHTML(html)
      const doc = document as unknown as Document
      indentRootChildren(doc)
      entry = { doc, original: serialize(doc) }
      this.#touched.set(full, entry)
    }
    if (!("doc" in entry)) throw new Error(`${path} was already deleted`)
    return entry.doc
  }

  create(path: string, seedHtml: string): Document {
    const full = resolvePath(this.#root, path)
    const { document } = parseHTML(seedHtml)
    // No "original" snapshot matches a real document's serialization, so a
    // created file is always written — same as today's behavior.
    this.#touched.set(full, { doc: document as unknown as Document, original: "" })
    return document as unknown as Document
  }

  delete(path: string): void {
    const full = resolvePath(this.#root, path)
    this.#touched.set(full, { deleted: true })
  }

  // Whether a path will be there once this run's writes land, which is not the
  // same question as what sits on disk right now. A command that deletes a file
  // and then asks about it gets the answer its own run produced, so a migration
  // walking the corpus it is halfway through rewriting sees that corpus rather
  // than the one it started from.
  exists(path: string): boolean {
    const entry = this.#touched.get(resolvePath(this.#root, path))
    if (entry) return !("deleted" in entry)
    return existsSync(resolvePath(this.#root, path))
  }

  // Reads every .html file under dir (relative to this Filesystem's root)
  // via get(), so every file it returns is tracked the same way a single
  // get() call would be — no separate read-only path, no separate tracking.
  list(dir: string): { path: string; doc: Document }[] {
    const full = resolvePath(this.#root, dir)
    return walkHtmlFiles(full)
      .map((file) => relativePath(this.#root, file))
      // A file this run deleted is gone from the corpus this run is building,
      // so listing it would hand back a document nobody can open — get() throws
      // on one. Same answer exists() gives. A file this run *created* is still
      // absent here, because the walk reads the disk and nothing is written
      // until the command returns.
      .filter((path) => this.exists(path))
      .map((path) => ({ path, doc: this.get(path) }))
  }

  // Calling this twice writes nothing the second time, which is what lets a
  // command flush partway through. A probe becomes a module addressed by its
  // own file and the loader reads that file, so a command creating an
  // experiment has to put it on disk before it can run one. Without this, the
  // engine's own commit afterwards would rewrite every file and log every line
  // again, and a second pass over a deleted document would throw.
  commit(): string[] {
    const written: string[] = []
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
      // What is on disk is now the original, so a later pass compares against
      // it rather than against what this document said before the command ran.
      entry.original = html
    }
    return written
  }
}

// Every command script is TypeScript — a type-only import at the top, a
// CommandContext annotation on every exported function's parameter. So
// this is parsed with the real TypeScript compiler rather than a JavaScript
// parser that would have to strip types first. ScriptKind.TSX is a strict
// superset of what a command script actually contains; see
// .mycelium/templates/code-comments.ts for why that is safe here.
function parseCommandSource(source: string): ts.SourceFile {
  return ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
}

function hasExportModifier(node: ts.Node): boolean {
  return !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
}

// Commands are discovered by their JSDoc, not a separate manifest: the
// engine never needs to know what a command means, only where its doc
// comment sits relative to the export it documents. Parsed with the real
// compiler rather than a regex so `export async function`, arrow-function
// exports, and reordered/reformatted commands all still get picked up
// correctly.
function exportedFunctionNames(stmt: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt) && stmt.name) return [stmt.name.text]
  // `export { addCase as case }`. A family names its commands after the types
  // it declares, and a type is free to be called something JavaScript reserves
  // as a keyword. The alias is the name the command line uses, so the alias is
  // the name the roster prints. Without this the command still works and no
  // reader finds out it exists, which is the one failure this roster exists to
  // prevent.
  if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    return stmt.exportClause.elements.map((element) => element.name.text)
  }
  if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) return []
  return stmt.declarationList.declarations
    .filter((d) => ts.isIdentifier(d.name) && !!d.initializer && (ts.isFunctionExpression(d.initializer) || ts.isArrowFunction(d.initializer)))
    .map((d) => (d.name as ts.Identifier).text)
}

function formatComment(raw: string): string {
  return raw
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)))
    .join("\n")
}

// The nearest block comment (JSDoc or plain) immediately preceding a node —
// the same idea acorn's comment list + distance check used to implement,
// now reading it directly off the compiler's own notion of a node's leading
// trivia.
function leadingBlockComment(source: string, node: ts.Node): string | undefined {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart())
  const doc = ranges?.filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia).pop()
  return doc ? source.slice(doc.pos, doc.end) : undefined
}

function extractCommandDocs(source: string): Map<string, string> {
  const docs = new Map<string, string>()
  const sourceFile = parseCommandSource(source)

  for (const stmt of sourceFile.statements) {
    const names = exportedFunctionNames(stmt)
    if (names.length === 0) continue
    const doc = leadingBlockComment(source, stmt)
    if (!doc) continue
    for (const name of names) docs.set(name, formatComment(doc))
  }
  return docs
}

// The opening sentence of a doc comment, as one line. Not its first LINE:
// these comments are hand-wrapped at roughly 72 columns, so a first line is
// as likely to end mid-clause as at a sentence boundary, and a roster of
// half-sentences reads as broken. Joins the leading paragraph
// back into one line and cuts at the first sentence-ending period, falling
// back to a hard truncation for a comment that opens with no period at all.
const SUMMARY_MAX = 76

function firstSentence(doc: string): string {
  const lines: string[] = []
  for (const line of doc.split("\n")) {
    if (!line.trim()) break
    lines.push(line.trim())
  }
  const paragraph = lines.join(" ")
  // Sentence-ending, not any period: "docs/" and "knowledge-<type>" contain
  // dots that are not sentence boundaries, so a period only counts when
  // followed by a space or the end of the paragraph.
  const end = /\.(\s|$)/.exec(paragraph)
  const sentence = end ? paragraph.slice(0, end.index + 1) : paragraph
  return sentence.length > SUMMARY_MAX ? sentence.slice(0, SUMMARY_MAX - 1).trimEnd() + "…" : sentence
}

// Every command a source EXPORTS, with the opening sentence of its doc comment.
// Deliberately not built on extractCommandDocs above: that one indexes
// non-exported top-level declarations too, which is harmless for printHelp
// because printHelp takes its NAMES from the loaded module's real exports
// and only asks the docs map for text. The roster never loads a module —
// it reads source only, so that it can describe every family without
// executing any of them. So it has to reject non-exports itself, or it
// would advertise a file's private helpers as commands.
function readCommands(source: string): { name: string; summary: string }[] {
  const sourceFile = parseCommandSource(source)
  const commands: { name: string; summary: string }[] = []

  for (const stmt of sourceFile.statements) {
    const names = exportedFunctionNames(stmt)
    if (names.length === 0) continue
    const doc = leadingBlockComment(source, stmt)
    for (const name of names) commands.push({ name, summary: doc ? firstSentence(formatComment(doc)) : "" })
  }
  return commands
}

// One line per command across every family, so no command can be invisible
// to someone who never thought to ask for the family it lives in. The point
// is the NAMES: a reader who knows `unlink` exists can get its flags from
// `<id> --help`, but a reader who doesn't concludes the capability is
// missing. That is what happened when a hand-maintained list in CLAUDE.md
// fell three commands behind what the CLI exports. Nobody maintains this
// by hand; printRoster reads it straight off the same command scripts the
// engine runs.
//
// A file is a command host only if its name ends in one of
// TEMPLATE_FILE_SUFFIXES, the same rule findTemplateFile uses to resolve an
// <id>. That matters beyond consistency: specs and plans QUOTE command
// scripts in escaped code blocks. A scan that went looking for the
// <script> tag alone would find a dozen frozen copies of older versions of
// these same commands and list them as real.
function printRoster(docsDir: string, stream: (line: string) => void) {
  stream("usage: mycelium <id> <command> [args…]")
  stream("       mycelium <id> --help          every flag and caveat for one family")
  stream("")

  const hosts = walkHtmlFiles(docsDir)
    .filter((file) => TEMPLATE_FILE_SUFFIXES.some((suffix) => file.endsWith(`.${suffix}`)))
    .sort()

  for (const file of hosts) {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    const script = document.querySelector('script[type="mycelium/command"]')
    if (!script) continue

    // A host this function cannot read is a real problem, but it is not
    // this function's problem. The roster's job is to be a complete index
    // of the families that DO work. So this names a broken one and steps
    // over it, rather than taking every other family down with it.
    let commands: { name: string; summary: string }[]
    try {
      commands = readCommands(script.textContent ?? "")
    } catch (err) {
      stream(`${basename(file)}  (unreadable: ${(err as Error).message})`)
      stream("")
      continue
    }
    if (commands.length === 0) continue

    const id = basename(file).replace(/\.(template|command)\.html$/, "")
    stream(`${id}  (${relativePath(docsDir, file)})`)
    const width = Math.max(...commands.map((c) => c.name.length))
    for (const { name, summary } of commands) stream(`  ${name.padEnd(width + 2)}${summary}`.trimEnd())
    stream("")
  }
}

// Every block comment anywhere in the file, in source order. An audit's own
// description sits after its imports rather than at the very top of the
// file, so finding only the trivia leading the first token would miss it.
// This walks every node instead, the same way code-comments.ts does for a
// rule checking a script's prose.
function allBlockComments(source: string, sourceFile: ts.SourceFile): { pos: number; raw: string }[] {
  const seen = new Set<number>()
  const found: { pos: number; raw: string }[] = []
  function record(pos: number, end: number, kind: ts.CommentKind) {
    if (kind !== ts.SyntaxKind.MultiLineCommentTrivia || seen.has(pos)) return
    seen.add(pos)
    found.push({ pos, raw: source.slice(pos, end) })
  }
  function visit(node: ts.Node) {
    ts.forEachLeadingCommentRange(source, node.getFullStart(), record)
    ts.forEachTrailingCommentRange(source, node.getEnd(), record)
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return found.sort((a, b) => a.pos - b.pos)
}

// The leading doc comment of a script that is one module rather than a set of
// exports. An audit is a single check, so its description sits at the top of
// the file instead of above an export, and readCommands would not find it.
function leadingComment(source: string): string {
  const sourceFile = parseCommandSource(source)
  const first = allBlockComments(source, sourceFile)[0]
  return first ? firstSentence(formatComment(first.raw)) : ""
}

// Every audit declared anywhere in the corpus, with what it holds true. Audits
// are the other half of what this tool does, and listing only commands is how
// one of them stayed invisible long enough for someone to write a writing
// rule duplicating it by hand.
function printAudits(docsDir: string, stream: (line: string) => void) {
  const found: { name: string; touches: string; summary: string; file: string }[] = []
  for (const file of walkHtmlFiles(docsDir)) {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    for (const script of Array.from(document.querySelectorAll("script[data-audits]"))) {
      found.push({
        name: script.getAttribute("data-audits")!,
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
    // Collapsed to a shared prefix when every touched type has one, so six
    // knowledge types read as one line. Pure string structure, so this stays
    // ignorant of what any family calls itself.
    const parts = audit.touches.trim().split(/\s+/).filter(Boolean)
    const prefixes = new Set(parts.map((t) => t.split("-")[0]))
    const touches = parts.length > 1 && prefixes.size === 1 ? `${[...prefixes][0]}-*` : audit.touches
    if (touches) stream(`  ${" ".repeat(width + 2)}touches ${touches}`)
  }
  stream("")
}

function printHelp(id: string, templateLabel: string, mod: Record<string, unknown>, source: string, stream: (line: string) => void) {
  const docs = extractCommandDocs(source)
  const names = Object.keys(mod).filter((k) => typeof mod[k] === "function")
  stream(`commands for "${id}" (${templateLabel}):\n`)
  for (const name of names) {
    stream(`  ${name}`)
    const doc = docs.get(name)
    stream(doc ? doc.split("\n").map((l) => `    ${l}`.trimEnd()).join("\n") : "    (no JSDoc comment)")
    stream("")
  }
}

// Node reports a closed downstream pipe as an 'error' event on stdout rather
// than killing the process with SIGPIPE the way a C program would. So any
// command printing more lines than `head` or `less` asks for dies with an
// unhandled EPIPE instead of stopping quietly. Commands that stream (list,
// and anything else printing per-node output) are exactly the ones people
// pipe. Only EPIPE is swallowed; every other stdout error still throws.
function exitQuietlyOnClosedPipe() {
  process.stdout.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0)
    throw err
  })
}

async function main() {
  exitQuietlyOnClosedPipe()
  const [id, namedCommand, ...rest] = process.argv.slice(2)
  const docsDir = resolvePath(CORPUS_DIR)

  // Help someone asked for goes to stdout and exits 0; help printed because
  // the invocation was wrong goes to stderr and exits non-zero. The usual
  // convention, but load-bearing here rather than cosmetic: a SessionStart
  // hook reads the roster. A hook that discards stderr (as this project's
  // does, to keep node's noise out of the transcript) would discard the
  // whole roster with it.
  const out = (line: string) => console.log(line)
  const err = (line: string) => console.error(line)

  // `mycelium` with nothing after it is a command rather than a mistake, so it
  // goes to stdout and exits zero the way an asked-for `--help` does. It makes
  // sure a corpus exists, then prints the roster of what that corpus can do.
  // Running it twice does the second half only.
  //
  // More may attach here later. Whatever does belongs on the same footing:
  // something a person wants when they type the bare name, and safe to repeat.
  if (!id || id === "--help" || id === "-h") {
    if (!id) seedCorpus(docsDir, out)
    if (!existsSync(docsDir)) {
      out(`No corpus here yet. Run \`mycelium\` with nothing after it to write one into ${CORPUS_DIR}/.`)
      process.exit(0)
    }
    printRoster(docsDir, out)
    printAudits(docsDir, out)
    process.exit(0)
  }

  // Every command reads the corpus, so none of them has anything to say without
  // one. Saying so here beats each command failing on its own missing path.
  if (!existsSync(docsDir)) {
    console.error(`no corpus at ${CORPUS_DIR}/ — run \`mycelium\` with nothing after it to write one`)
    process.exit(1)
  }

  const templateFile = findTemplateFile(docsDir, id)
  if (!templateFile) {
    console.error(`no command host found for "${id}" (looked for ${id}.template.html or ${id}.command.html)`)
    process.exit(1)
  }
  const templateLabel = relativePath(docsDir, templateFile)

  const { document } = parseHTML(readFileSync(templateFile, "utf8"))
  const script = document.querySelector('script[type="mycelium/command"]')
  if (!script) {
    console.error(`${templateLabel} has no <script type="mycelium/command">`)
    process.exit(1)
  }

  const source = script.textContent ?? ""
  const mod = await loadModule(templateFile, script)

  // A host may export a default, for when naming a subcommand would only
  // repeat the host's own name: `mycelium validate` rather than `mycelium
  // validate validate`. A flag in the subcommand slot belongs to that
  // default too, so `mycelium validate --dir x` reads as one invocation
  // rather than a command named "--dir". Asking for --help still prints
  // help instead of running anything, and a host with no default still
  // prints help when nothing follows it, exactly as before.
  const isHelp = namedCommand === "--help" || namedCommand === "-h"
  const useDefault =
    typeof mod.default === "function" && !isHelp && (!namedCommand || namedCommand.startsWith("-"))
  const command = useDefault ? "default" : namedCommand
  const commandArgs = useDefault && namedCommand ? [namedCommand, ...rest] : rest

  if (!command || command === "--help" || command === "-h") {
    printHelp(id, templateLabel, mod, source, command ? out : err)
    process.exit(command ? 0 : 1)
  }

  const run = mod[command] as ((ctx: CommandContext) => void | Promise<void>) | undefined
  if (typeof run !== "function") {
    console.error(`${templateLabel} has no "${command}" command\n`)
    printHelp(id, templateLabel, mod, source, err)
    process.exit(1)
  }

  const args = parseArgs(commandArgs)

  // Path math for link-style commands. Both arguments are paths from the docs
  // root, because the command resolves them itself — it knows which directory
  // its family writes to and the engine does not. A target above the source's
  // directory keeps its leading `..`; only a sibling or a descendant gets the
  // `./` prefix, so an href here reads the same as a hand-written one.
  const href: Cli["href"] = (from, to) => {
    const path = relativePath(dirname(resolvePath(docsDir, from)), resolvePath(docsDir, to))
    return path.startsWith(".") ? path : `./${path}`
  }

  const validate: Validate = (root, instancePath) => validateInstance(docsDir, instancePath, root)
  const cli: Cli = { validate, readStdin, parseHTML, href }

  const fs = new Filesystem(docsDir)
  try {
    await run({ fs, args, cli })
    fs.commit()
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}

main()
