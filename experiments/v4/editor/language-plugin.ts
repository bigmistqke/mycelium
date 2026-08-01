// A Volar language plugin for this project's HTML documents.
//
// The problem it solves is stated in
// docs/specs/2026-08-01-script-type-decides-the-language.spec.html: an HTML
// language service builds one virtual JavaScript document per HTML file and
// concatenates every script into it, which merges scopes that are separate when
// they run, and it ignores a script whose type it does not recognize, which is
// every script this project actually cares about.
//
// Both follow from the same mistake — treating a file as the unit — so this
// treats a script block as the unit. Every block becomes its own virtual file
// with its own module scope, named after its position, and its language comes
// from its type the same way the load hook decides its format:
//
//   type="mycelium/*"        Node only, so TypeScript
//   type="module", classic   a browser, so JavaScript
//
// The blocks are found by scanning the text rather than by parsing the
// document. A <script> is raw text until its closing tag, which is what makes
// scanning sound here and is the same property the authoring spec relies on to
// embed HTML inside a command's own source.

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
    blocks.push({ type, start: match.index + match[0].indexOf(">", 1 + attrs.length) + 1, text })
  }
  return blocks
}

// A mycelium/* script never runs in a browser, so it may carry type
// annotations. Everything else has to stay valid JavaScript. Same rule, and the
// same prefix test, as formatFor in src/script-hooks.ts — if one changes the
// other is wrong.
export function isNodeOnly(type: string): boolean {
  return type.startsWith("mycelium/")
}

// One mapping covering the whole block: every position in the virtual file
// corresponds to a position in the source, offset by where the block starts. No
// generated text is added, so there is nothing to exclude.
function wholeBlockMapping(block: ScriptBlock): CodeMapping {
  return {
    sourceOffsets: [block.start],
    generatedOffsets: [0],
    lengths: [block.text.length],
    data: {
      verification: true,
      completion: true,
      semantic: true,
      navigation: true,
      structure: true,
      format: false,
    },
  }
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

    createVirtualCode(_uri, languageId, snapshot) {
      if (languageId !== "html") return undefined
      const html = snapshot.getText(0, snapshot.getLength())
      const blocks = findScriptBlocks(html)
      return {
        id: "root",
        languageId: "html",
        snapshot,
        // The root itself maps nothing: the HTML around the scripts is not
        // code, and claiming it is would put TypeScript diagnostics on prose.
        mappings: [],
        embeddedCodes: blocks.map((block, i) => ({
          id: `script_${i}`,
          languageId: isNodeOnly(block.type) ? "typescript" : "javascript",
          snapshot: snapshotOf(block.text),
          mappings: [wholeBlockMapping(block)],
        })),
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
      // Volar hands this the base VirtualCode type, so the blocks recorded
      // alongside the embedded codes are read back through the shape this
      // plugin is the only producer of.
      getExtraServiceScripts(fileName, root) {
        const blocks = (root as MyceliumRoot).blocks
        return root.embeddedCodes!.map((code, i) => {
          const block = blocks[i]
          const ext = isNodeOnly(block.type) ? ".ts" : ".js"
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
