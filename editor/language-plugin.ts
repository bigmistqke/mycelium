// A Volar language plugin for this project's HTML documents.
//
// The problem it solves is stated in
// .mycelium/specs/2026-08-01-script-type-decides-the-language.spec.html. An HTML
// language service builds one virtual JavaScript document per HTML file and
// concatenates every script into it, which merges scopes that are separate
// when they run. It also ignores a script whose type it does not
// recognize, which is every script this project actually cares about.
//
// Both follow from the same mistake — treating a file as the unit — so this
// treats a script block as the unit. Every block becomes its own virtual file
// with its own module scope, named after its position, and its language comes
// from its type the same way the load hook decides its format:
//
//   type="mycelium/*"        Node only, so TypeScript
//   type="module", classic   a browser, so JavaScript
//
// This scans the text for the blocks rather than parsing the document. A
// <script> is raw text until its closing tag, which is what makes scanning
// sound here and is the same property the authoring spec relies on to embed
// HTML inside a command's own source.

import type { LanguagePlugin, VirtualCode, CodeMapping } from "@volar/language-core"
// Imported for its side effect on the type system only: @volar/typescript
// declares the `typescript` field below onto LanguagePlugin, and without this
// the field is an unknown property.
import type {} from "@volar/typescript"
import type { URI } from "vscode-uri"
import type ts from "typescript"

export interface ScriptBlock {
  /** Script type attribute, "" for a classic script with none. */
  type: string
  /** The script's id attribute, if it has one — what a locator "#id" addresses. */
  id: string | undefined
  /** Offset of the block's content in the containing HTML file. */
  start: number
  text: string
}

// The two forms in play. Nothing else is a script whose contents this reads.
const SCRIPT = /<script([^>]*)>([\s\S]*?)<\/script>/g

export function findScriptBlocks(html: string): ScriptBlock[] {
  const blocks: ScriptBlock[] = []
  for (const match of html.matchAll(SCRIPT)) {
    const attrs = match[1]
    const text = match[2]
    const type = /type\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? ""
    const id = /\bid\s*=\s*"([^"]*)"/.exec(attrs)?.[1]
    blocks.push({ type, id, start: match.index + match[0].indexOf(">", 1 + attrs.length) + 1, text })
  }
  return blocks
}

// A mycelium/* script never runs in a browser, so it may carry type
// annotations. Everything else has to stay valid JavaScript. Same rule, and the
// same prefix test, as formatFor in src/script-hooks.js — if one changes the
// other is wrong.
export function isNodeOnly(type: string): boolean {
  return type.startsWith("mycelium/")
}

// mycelium/importmap is the one mycelium/* type that is not code: a rule's
// own JSON, read with JSON.parse rather than imported. TypeScript reads an
// object literal at this position as a block statement, so real content
// here would earn it spurious diagnostics.
//
// It gets an empty virtual file instead. Its slot in the array still has to
// exist, since buildBlockCode's #locator rewriting and
// getExtraServiceScripts both name a sibling by position.
function isOpaqueData(type: string): boolean {
  return type === "mycelium/importmap"
}

function extensionFor(block: ScriptBlock): ".ts" | ".js" {
  return isNodeOnly(block.type) ? ".ts" : ".js"
}

// The same locator a bare "#<locator>" resolves to at run time
// (src/script-hooks.js's resolve()) is either the id an author wrote, or
// "@N", the Nth <script> tag in the document. Both are computed
// identically here and there from the same real file, so a block with no
// id is still addressable.
function findBlockIndexByLocator(blocks: ScriptBlock[], locator: string): number | undefined {
  if (locator.startsWith("@")) {
    const index = Number(locator.slice(1))
    return blocks[index] ? index : undefined
  }
  const index = blocks.findIndex((b) => b.id === locator)
  return index === -1 ? undefined : index
}

// A module specifier sitting right after "from" or "import"/"import(" — the
// same shapes script-hooks.js's resolve() has to handle at run time, minus
// specifiers built by string concatenation, which neither hook can see
// through. Text scanning rather than parsing, same tradeoff findScriptBlocks
// above already makes, so a "#…" string sitting inside a comment or an
// unrelated string literal at exactly that position could false-match; not
// solved here, same as it is not solved there.
const HASH_SPECIFIER = /(?<=\b(?:from|import)\s*\(?\s*)(['"])#([^'"]*)\1/g

// Builds one block's virtual file text and its mapping back to the HTML
// source. A bare "#locator" import is TypeScript's own reserved
// package-subpath-import syntax. TypeScript has no idea this project
// overloads it to mean "the sibling script with this id", which
// script-hooks.js's resolve() does at run time. So left alone it is
// always "cannot find module".
// Rewriting it here to a real relative path to that sibling's own virtual
// file lets TypeScript's ordinary module resolution do the rest.
//
// This has to happen at the text level: nothing in @volar/typescript's plugin
// surface survives past project creation to hang a custom resolver on.
// The resolveLanguageServiceHost hook looked like the right one, but
// createProject.js unconditionally reinstalls resolveModuleNameLiterals
// right after calling every plugin's hook. This project found that fact
// by reading the installed package directly rather than trusting the type
// signature, after wiring the hook up once and watching it do nothing.
//
// Only the locator's own quoted text is replaced; everything else is copied
// through unchanged. The generatedLengths option lets one mapping segment
// have a different length on each side. So a diagnostic on a locator that
// resolves to nothing still lands on the original "#locator" text in the
// HTML file, not on where the replacement would have been.
function buildBlockCode(
  block: ScriptBlock,
  blocks: ScriptBlock[],
  htmlBaseName: string,
): { text: string; mapping: CodeMapping } {
  const sourceOffsets: number[] = []
  const generatedOffsets: number[] = []
  const lengths: number[] = []
  const generatedLengths: number[] = []
  let generatedText = ""
  let cursor = 0

  function copyThrough(end: number) {
    if (end <= cursor) return
    const length = end - cursor
    sourceOffsets.push(block.start + cursor)
    generatedOffsets.push(generatedText.length)
    lengths.push(length)
    generatedLengths.push(length)
    generatedText += block.text.slice(cursor, end)
    cursor = end
  }

  for (const match of block.text.matchAll(HASH_SPECIFIER)) {
    const quote = match[1]
    const matchStart = match.index
    const matchEnd = matchStart + match[0].length
    copyThrough(matchStart)

    const locator = decodeURIComponent(match[2])
    const targetIndex = findBlockIndexByLocator(blocks, locator)
    const replacement =
      targetIndex === undefined
        ? match[0] // no such sibling — leave it, so "cannot find module" still fires
        : `${quote}./${htmlBaseName}.${targetIndex}${extensionFor(blocks[targetIndex])}${quote}`

    sourceOffsets.push(block.start + matchStart)
    generatedOffsets.push(generatedText.length)
    lengths.push(match[0].length)
    generatedLengths.push(replacement.length)
    generatedText += replacement
    cursor = matchEnd
  }
  copyThrough(block.text.length)

  return {
    text: generatedText,
    mapping: {
      sourceOffsets,
      generatedOffsets,
      lengths,
      generatedLengths,
      data: {
        verification: true,
        completion: true,
        semantic: true,
        navigation: true,
        structure: true,
        format: false,
      },
    },
  }
}

// What an opaque block maps to: nothing, since it has no real content to
// carry a diagnostic back to.
const EMPTY_MAPPING: CodeMapping = {
  sourceOffsets: [],
  generatedOffsets: [],
  lengths: [],
  generatedLengths: [],
  data: { verification: false, completion: false, semantic: false, navigation: false, structure: false, format: false },
}

function snapshotOf(text: string): ts.IScriptSnapshot {
  return {
    getText: (start, end) => text.slice(start, end),
    getLength: () => text.length,
    getChangeRange: () => undefined,
  }
}

export interface MyceliumRoot extends VirtualCode {
  blocks: ScriptBlock[]
}

export function createMyceliumLanguagePlugin(
  typescriptModule: typeof ts,
): LanguagePlugin<URI, MyceliumRoot> {
  return {
    getLanguageId(uri) {
      if (uri.path.endsWith(".html")) return "html"
      return undefined
    },

    createVirtualCode(uri, languageId, snapshot) {
      if (languageId !== "html") return undefined
      const html = snapshot.getText(0, snapshot.getLength())
      const blocks = findScriptBlocks(html)
      // getExtraServiceScripts below names a block's virtual file
      // "${fileName}.${i}${ext}", so every block from this document shares
      // one directory — the specifiers buildBlockCode writes only need this
      // basename, not the full path, to reach a sibling.
      const htmlBaseName = uri.path.slice(uri.path.lastIndexOf("/") + 1)
      return {
        id: "root",
        languageId: "html",
        snapshot,
        // The root itself maps nothing: the HTML around the scripts is not
        // code, and claiming it is would put TypeScript diagnostics on prose.
        mappings: [],
        embeddedCodes: blocks.map((block, i) => {
          const { text, mapping } = isOpaqueData(block.type)
            ? { text: "", mapping: EMPTY_MAPPING }
            : buildBlockCode(block, blocks, htmlBaseName)
          return {
            id: `script_${i}`,
            languageId: isNodeOnly(block.type) ? "typescript" : "javascript",
            snapshot: snapshotOf(text),
            mappings: [mapping],
          }
        }),
        blocks,
      }
    },

    typescript: {
      extraFileExtensions: [
        { extension: "html", isMixedContent: true, scriptKind: 7 satisfies ts.ScriptKind.Deferred },
      ],

      // The HTML file itself is not a TypeScript file. Returning nothing here is
      // what keeps every block a separate file below, rather than one merged
      // document per HTML file — which is the whole point.
      getServiceScript() {
        return undefined
      },

      // One real TypeScript file per script block. Separate files mean separate
      // module scopes, so two blocks in one document may each declare `lines`,
      // exactly as they may at run time.
      // Volar hands this the base VirtualCode type, so this reads the
      // blocks recorded alongside the embedded codes back through the
      // shape only this plugin produces.
      getExtraServiceScripts(fileName, root) {
        const blocks = (root as MyceliumRoot).blocks
        return root.embeddedCodes!.map((code, i) => {
          const block = blocks[i]
          const ext = extensionFor(block)
          return {
            fileName: `${fileName}.${i}${ext}`,
            code,
            extension: ext,
            scriptKind: (isNodeOnly(block.type)
              ? typescriptModule.ScriptKind.TS
              : typescriptModule.ScriptKind.JS) satisfies ts.ScriptKind,
          }
        })
      },
    },
  }
}
