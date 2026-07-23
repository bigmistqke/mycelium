// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// crawl.ts: the engine knows <template>, data-conforms-to, and how to find
// the one script[type="mycelium/command"] a template file declares — never
// what any command actually does. See
// docs/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { parse } from "acorn"
import { parseHTML, walkHtmlFiles } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

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
class Filesystem {
  #root: string
  #touched = new Map<string, { doc: Document } | { deleted: true }>()

  constructor(root: string) {
    this.#root = root
  }

  get(path: string): Document {
    const full = resolvePath(this.#root, path)
    let entry = this.#touched.get(full)
    if (!entry) {
      const html = readFileSync(full, "utf8")
      const { document } = parseHTML(html)
      entry = { doc: document as unknown as Document }
      this.#touched.set(full, entry)
    }
    if (!("doc" in entry)) throw new Error(`${path} was already deleted`)
    return entry.doc
  }

  create(path: string, seedHtml: string): Document {
    const full = resolvePath(this.#root, path)
    const { document } = parseHTML(seedHtml)
    this.#touched.set(full, { doc: document as unknown as Document })
    return document as unknown as Document
  }

  delete(path: string): void {
    const full = resolvePath(this.#root, path)
    this.#touched.set(full, { deleted: true })
  }

  commit(): string[] {
    const written: string[] = []
    for (const [full, entry] of this.#touched) {
      const label = relativePath(this.#root, full)
      if ("deleted" in entry) {
        unlinkSync(full)
        console.log(`deleted  ${label}`)
      } else {
        const html = "<!DOCTYPE html>\n" + entry.doc.documentElement!.outerHTML + "\n"
        writeFileSync(full, html)
        console.log(`wrote    ${label}`)
        written.push(full)
      }
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

  const run = mod[command] as ((fs: Filesystem, args: ParsedArgs) => void | Promise<void>) | undefined
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

  const fs = new Filesystem(docsDir)
  await run(fs, args)
  fs.commit()
}

main()
