// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// validate.ts: the engine knows <template>, data-conforms-to, and how to find
// the one script[type="mycelium/command"] a template file declares — never
// what any command actually does. See
// docs/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { basename, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { register } from "node:module"
import { parse } from "acorn"
import { parseHTML, walkHtmlFiles, validateInstance, readStdin, loadModule } from "./utils.ts"

register("./script-hooks.ts", import.meta.url)

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>

interface Cli {
  validate: Validate
  readStdin: () => Promise<string>
  parseHTML: (html: string) => { document: Document }
}

interface CommandContext {
  fs: Filesystem
  args: ParsedArgs
  cli: Cli
}

// A command host is either a content family's own <id>.template.html
// (instances conform to it via data-conforms-to) or a singleton
// <id>.command.html with no instances of its own — a whole-docs-tree tool
// like docs/commands/explore.command.html. Both are found the same way,
// searched in that order so a family template always wins a name clash.
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

interface ParsedArgs {
  _: string[]
  [key: string]: string | string[]
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token.startsWith("--")) {
      args[token.slice(2)] = argv[i + 1]
      i++
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
// writing, skipping any file that was read but never actually mutated.
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

function serialize(doc: Document): string {
  collapseFormattingWhitespace(doc.documentElement!)
  return doc.documentElement!.outerHTML
}

// Reindents every data-conforms-to element's direct children with
// consistent 2-space-per-level indentation, matching this project's own
// hand-authored style. Plain appendChild() — what every command's
// field()-style helper does — leaves every field butted up against its
// neighbor with no whitespace at all. Strips any existing whitespace-only
// text children first and rebuilds from scratch, so this is safe to call
// more than once on the same document (get() calls it once for the
// comparison snapshot; commit() calls it again as the last step before
// writing, after whatever a command did to the tree in between).
//
// Most families (knowledge-*, spec-doc) only ever have one conforming
// element per document, so this used to look for a single root. plan-*
// nests conforming types three deep (plan-doc > plan-task > plan-step >
// plan-check), so every [data-conforms-to] element in the document is now
// reindented independently, each at a depth based on how many *other
// conforming elements* (not raw DOM ancestors — <html>/<head>/<body>
// don't count) contain it. A top-level root (depth 0) gets exactly the
// indentation this function has always produced; a nested one gets
// indented two spaces deeper per level of conforming-element nesting.
//
// Still reformats one level only, per element — anything nested inside a
// non-conforming child (e.g. knowledge-detail's or plan-detail's own
// arbitrary markup) is left exactly as authored, since reformatting
// arbitrary nested content risks corrupting significant whitespace inside
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

  // Reads every .html file under dir (relative to this Filesystem's root)
  // via get(), so every file it returns is tracked the same way a single
  // get() call would be — no separate read-only path, no separate tracking.
  list(dir: string): { path: string; doc: Document }[] {
    const full = resolvePath(this.#root, dir)
    return walkHtmlFiles(full).map((file) => {
      const path = relativePath(this.#root, file)
      return { path, doc: this.get(path) }
    })
  }

  commit(): string[] {
    const written: string[] = []
    for (const [full, entry] of this.#touched) {
      const label = relativePath(this.#root, full)
      if ("deleted" in entry) {
        unlinkSync(full)
        console.log(`deleted  ${label}`)
        continue
      }
      indentRootChildren(entry.doc)
      const html = serialize(entry.doc)
      if (html === entry.original) continue
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, "<!DOCTYPE html>\n" + html + "\n")
      console.log(`wrote    ${label}`)
      written.push(full)
    }
    return written
  }
}

// Commands are discovered by their JSDoc, not a separate manifest: the
// engine never needs to know what a command means, only where its doc
// comment sits relative to the export it documents. Parsed with acorn
// rather than a regex so `export async function`, arrow-function exports,
// and reordered/reformatted commands all still get picked up correctly.
function exportedFunctionNames(node: any): string[] {
  if (node.type === "FunctionDeclaration" && node.id) return [node.id.name]
  if (node.type !== "ExportNamedDeclaration" || !node.declaration) return []
  const decl = node.declaration
  if (decl.type === "FunctionDeclaration" && decl.id) return [decl.id.name]
  if (decl.type !== "VariableDeclaration") return []
  return decl.declarations
    .filter((d: any) => d.id?.type === "Identifier" && /Function/.test(d.init?.type ?? ""))
    .map((d: any) => d.id.name)
}

function formatComment(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)))
    .join("\n")
}

function extractCommandDocs(source: string): Map<string, string> {
  const docs = new Map<string, string>()
  const comments: { type: string; value: string; start: number; end: number }[] = []
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", onComment: comments })

  for (const node of (ast as any).body) {
    const names = exportedFunctionNames(node)
    if (names.length === 0) continue
    // The doc comment for this export is the nearest preceding block
    // comment with only whitespace between its `*/` and the export.
    const doc = comments
      .filter((c) => c.type === "Block" && c.end <= node.start && /^\s*$/.test(source.slice(c.end, node.start)))
      .sort((a, b) => b.end - a.end)[0]
    if (!doc) continue
    for (const name of names) docs.set(name, formatComment(doc.value))
  }
  return docs
}

// The opening sentence of a doc comment, as one line. Not its first LINE:
// these comments are hand-wrapped at roughly 72 columns, so a first line is
// as likely to end mid-clause as at a sentence boundary, and a roster made
// of half-sentences reads like it is broken. Joins the leading paragraph
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
// executing any of them — so it has to reject non-exports itself or it
// would advertise a file's private helpers as commands.
function readCommands(source: string): { name: string; summary: string }[] {
  const comments: { type: string; value: string; start: number; end: number }[] = []
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module", onComment: comments })
  const commands: { name: string; summary: string }[] = []

  for (const node of (ast as any).body) {
    if (node.type !== "ExportNamedDeclaration" || !node.declaration) continue
    const names = exportedFunctionNames(node)
    if (names.length === 0) continue
    const doc = comments
      .filter((c) => c.type === "Block" && c.end <= node.start && /^\s*$/.test(source.slice(c.end, node.start)))
      .sort((a, b) => b.end - a.end)[0]
    for (const name of names) commands.push({ name, summary: doc ? firstSentence(formatComment(doc.value)) : "" })
  }
  return commands
}

// One line per command across every family, so no command can be invisible
// to someone who never thought to ask for the family it lives in. The point
// is the NAMES: a reader who knows `unlink` exists can get its flags from
// `<id> --help`, but a reader who doesn't concludes the capability is
// missing — which is what happened when a hand-maintained list in CLAUDE.md
// fell three commands behind what the CLI exports. Nothing here is
// maintained by hand; it is read off the same command scripts the engine
// runs.
//
// A file is a command host only if its name ends in one of
// TEMPLATE_FILE_SUFFIXES, the same rule findTemplateFile uses to resolve an
// <id>. That matters beyond consistency: specs and plans QUOTE command
// scripts in escaped code blocks, so a scan that went looking for the
// <script> tag alone would find a dozen frozen copies of older versions of
// these same commands and list them as real.
function printRoster(docsDir: string, stream: (line: string) => void) {
  stream("usage: mycelium run <id> <command> [args…]")
  stream("       mycelium run <id> --help          every flag and caveat for one family")
  stream("")

  const hosts = walkHtmlFiles(docsDir)
    .filter((file) => TEMPLATE_FILE_SUFFIXES.some((suffix) => file.endsWith(`.${suffix}`)))
    .sort()

  for (const file of hosts) {
    const { document } = parseHTML(readFileSync(file, "utf8"))
    const script = document.querySelector('script[type="mycelium/command"]')
    if (!script) continue

    // A host whose script acorn can't parse is a real problem, but it is
    // not this function's problem — the roster's job is to be a complete
    // index of the families that DO work, so a broken one is named and
    // stepped over rather than taking every other family down with it.
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

// The leading doc comment of a script that is one module rather than a set of
// exports. An audit is a single check, so its description sits at the top of
// the file instead of above an export, and readCommands would not find it.
function leadingComment(source: string): string {
  const comments: { type: string; value: string; start: number; end: number }[] = []
  try {
    parse(source, { ecmaVersion: "latest", sourceType: "module", onComment: comments })
  } catch {
    return ""
  }
  const first = comments.filter((c) => c.type === "Block").sort((a, b) => a.start - b.start)[0]
  return first ? firstSentence(formatComment(first.value)) : ""
}

// Every audit declared anywhere under docs/, with what it holds true. Audits
// are the other half of what this tool does, and listing only commands is how
// one of them stayed invisible long enough for a writing rule duplicating it
// to be written by hand.
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
// than killing the process with SIGPIPE the way a C program would, so any
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
  const [id, command, ...rest] = process.argv.slice(2)
  const docsDir = resolvePath("./docs")

  // Help that was asked for goes to stdout and exits 0; help printed because
  // the invocation was wrong goes to stderr and exits non-zero. The usual
  // convention, but load-bearing here rather than cosmetic: the roster is
  // read by a SessionStart hook, and a hook that discards stderr (as this
  // project's does, to keep node's noise out of the transcript) would
  // discard the whole roster with it.
  const out = (line: string) => console.log(line)
  const err = (line: string) => console.error(line)

  if (!id || id === "--help" || id === "-h") {
    printRoster(docsDir, id ? out : err)
    printAudits(docsDir, id ? out : err)
    process.exit(id ? 0 : 1)
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

  const args = parseArgs(rest)

  // Generic path math for link-style commands: if two file arguments were
  // given (`link <from> <to> …`), precompute the relative href between
  // them so the command never has to know where either file lives on disk.
  if (args._.length >= 2) {
    const [from, to] = args._
    args.href = "./" + relativePath(dirname(resolvePath(docsDir, from)), resolvePath(docsDir, to))
  }

  const validate: Validate = (root, instancePath) => validateInstance(docsDir, instancePath, root)
  const cli: Cli = { validate, readStdin, parseHTML }

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
