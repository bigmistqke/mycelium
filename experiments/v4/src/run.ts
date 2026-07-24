// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// validate.ts: the engine knows <template>, data-conforms-to, and how to find
// the one script[type="mycelium/command"] a template file declares — never
// what any command actually does. See
// docs/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { parse } from "acorn"
import { parseHTML, walkHtmlFiles, validateInstance, readStdin } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>

interface Cli {
  validate: Validate
  readStdin: () => Promise<string>
}

interface CommandContext {
  fs: Filesystem
  args: ParsedArgs
  cli: Cli
}

function findTemplateFile(dir: string, id: string): string | null {
  const target = `${id}.template.html`
  return walkHtmlFiles(dir).find((f) => f.endsWith(`/${target}`)) ?? null
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
// happy-dom's own parse/serialize round-trip inflates any blank line
// sitting just before a closing tag into several (a document.write()
// quirk, not anything this project's own templates do) — collapsed back
// down here, applied identically at snapshot time and write time so the
// unchanged-file comparison below still cancels out correctly.
function normalizeWhitespace(html: string): string {
  return html.replace(/\n{2,}/g, "\n")
}

// Reindents the data-conforms-to root's direct children with consistent
// 2-space indentation, matching this project's own hand-authored style.
// Plain appendChild() — what every command's field()-style helper does —
// leaves every field butted up against its neighbor with no whitespace at
// all. Strips any existing whitespace-only text children first and
// rebuilds from scratch, so this is safe to call more than once on the
// same document (get() calls it once for the comparison snapshot; commit()
// calls it again as the last step before writing, after whatever a
// command did to the tree in between). Reformats one level only —
// anything nested inside a child (e.g. knowledge-detail's own markup) is
// left exactly as authored, since reformatting arbitrary nested content
// risks corrupting significant whitespace inside <pre>/<script>.
function indentRootChildren(doc: Document): void {
  const root = doc.querySelector("[data-conforms-to]")
  if (!root) return
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3 && !node.textContent?.trim()) node.remove()
  }
  const children = Array.from(root.children)
  for (const el of children) root.insertBefore(doc.createTextNode("\n  "), el)
  if (children.length > 0) root.appendChild(doc.createTextNode("\n"))
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
      entry = { doc, original: normalizeWhitespace(doc.documentElement!.outerHTML) }
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
      const html = normalizeWhitespace(entry.doc.documentElement!.outerHTML)
      if (html === entry.original) continue
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

function printHelp(id: string, templateLabel: string, mod: Record<string, unknown>, source: string) {
  const docs = extractCommandDocs(source)
  const names = Object.keys(mod).filter((k) => typeof mod[k] === "function")
  console.error(`commands for "${id}" (${templateLabel}):\n`)
  for (const name of names) {
    console.error(`  ${name}`)
    const doc = docs.get(name)
    console.error(doc ? doc.split("\n").map((l) => `    ${l}`.trimEnd()).join("\n") : "    (no JSDoc comment)")
    console.error("")
  }
}

async function main() {
  const [id, command, ...rest] = process.argv.slice(2)
  if (!id) {
    console.error("usage: mycelium run <id> <command> [args…]\n       mycelium run <id> --help")
    process.exit(1)
  }

  const docsDir = resolvePath("./docs")
  const templateFile = findTemplateFile(join(docsDir, "templates"), id)
  if (!templateFile) {
    console.error(`no template file found for "${id}" (looked for ${id}.template.html)`)
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
  const mod = await loadModule(source)

  if (!command || command === "--help" || command === "-h") {
    printHelp(id, templateLabel, mod, source)
    process.exit(command ? 0 : 1)
  }

  const run = mod[command] as ((ctx: CommandContext) => void | Promise<void>) | undefined
  if (typeof run !== "function") {
    console.error(`${templateLabel} has no "${command}" command\n`)
    printHelp(id, templateLabel, mod, source)
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
  const cli: Cli = { validate, readStdin }

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
