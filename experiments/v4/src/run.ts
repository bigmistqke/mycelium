// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// crawl.ts: the engine knows <template>, data-conforms-to, and how to find
// the one script[type="mycelium/command"] a template file declares — never
// what any command actually does. See
// docs/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { Window } from "happy-dom"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

function parseHTML(html: string): { document: Document } {
  const window = new Window()
  window.document.write(html)
  return { document: window.document as unknown as Document }
}

function walkHtmlFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) results.push(...walkHtmlFiles(full))
    else if (entry.endsWith(".html")) results.push(full)
  }
  return results
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
// comment sits relative to its `export function` line.
function extractCommandDocs(source: string): Map<string, string> {
  const docs = new Map<string, string>()
  const re = /\/\*\*([\s\S]*?)\*\/\s*export function (\w+)/g
  for (const m of source.matchAll(re)) {
    const body = m[1]
      .split("\n")
      .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
      .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)))
      .join("\n")
    docs.set(m[2], body)
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
