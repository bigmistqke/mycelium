// Runs the language plugin over real documents and prints what it reports, so
// the plugin can be checked without an editor in the loop.
//
//   node editor/check.ts [file.html ...]
//
// With no arguments it checks every HTML file under docs/. Diagnostics come
// back mapped to positions in the HTML file itself, not in the virtual files,
// which is the part worth watching: a wrong mapping shows up here as a line
// number that does not match the source.

import { createTypeScriptChecker } from "@volar/kit"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { resolve, relative } from "node:path"
import { readFileSync } from "node:fs"
import { createMyceliumLanguagePlugin, findScriptBlocks, isNodeOnly } from "./language-plugin.ts"
import { walkHtmlFiles } from "../src/utils.ts"

const root = resolve(import.meta.dirname, "..")
const tsconfig = resolve(root, "tsconfig.json")

const checker = createTypeScriptChecker(
  [createMyceliumLanguagePlugin(ts)],
  createTypeScriptServices(ts),
  tsconfig,
)

const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => resolve(f))
  : walkHtmlFiles(resolve(root, "docs"))

let total = 0
let withCode = 0
for (const file of files) {
  const html = readFileSync(file, "utf8")
  const blocks = findScriptBlocks(html).filter((b) => isNodeOnly(b.type))
  if (blocks.length === 0) continue
  withCode++
  const diagnostics = await checker.check(file)
  total += diagnostics.length
  if (diagnostics.length) {
    console.log(checker.printErrors(file, diagnostics, root))
  }
}
console.log(`${withCode} document(s) with mycelium/* scripts, ${total} diagnostic(s)`)
