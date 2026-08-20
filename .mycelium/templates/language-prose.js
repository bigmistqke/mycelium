// Shared by prose-follows-the-language (corpus documents) and language lint's file mode (ad-hoc files).

import { marked } from "marked"
import { parseHTMLWithLocations, findFirstByTag } from "mycelium/utils"

// Text no rule may be applied to: code, a quotation, or a recorded prompt.
export const PROTECTED_TAGS = new Set([
  "pre", "code", "script", "style",
  "q", "blockquote", "language-avoid",
  "notebook-prompt", "plan-global-constraints", "language-fail",
])

// A block ends with a newline so paragraphs don't run together; each is its own rewrite unit.
export const BLOCK_TAGS = new Set(["p", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dt", "dd", "figcaption"])

/**
 * @param {any} node
 * @returns {string}
 */
export function extractProse(node) {
  let out = ""
  for (const child of /** @type {any[]} */ (Array.from(node.childNodes))) {
    if (child.nodeType === 3) { out += child.textContent ?? ""; continue }
    const tag = child.tagName?.toLowerCase()
    if (!tag || PROTECTED_TAGS.has(tag)) continue
    out += extractProse(child)
    if (BLOCK_TAGS.has(tag)) out += "\n"
  }
  return out
}

/**
 * A rule reading markup queries a copy with every protected element already
 * gone, the same guarantee the audit gives every rule over a real
 * document. It cannot reach a code block, a recorded prompt, or a rule's
 * own failing example, because those elements are not there to find.
 *
 * @param {any} node
 * @returns {any}
 */
export function stripProtected(node) {
  const clone = node.cloneNode(true)
  for (const el of Array.from(clone.querySelectorAll([...PROTECTED_TAGS].join(",")))) /** @type {any} */ (el).remove()
  return clone
}

/**
 * Real markdown, not a hand-rolled approximation of it. A first attempt at
 * this (blank-line paragraphs, a regex per inline span) got the common cases
 * right and a real one wrong on the first real document it ran against. A
 * list item's text wrapped onto a continuation line with no marker of its
 * own, which silently turned the whole list into one overlong paragraph.
 * The marked library already gets wrapped list items, nested lists,
 * blockquotes, tables, and every inline span right, which is exactly the
 * class of bug a hand-rolled version keeps re-discovering one document at
 * a time.
 *
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToHtmlFragment(markdown) {
  return /** @type {string} */ (marked.parse(markdown, { async: false }))
}

/**
 * One range per top-level markdown paragraph, in source order, with the
 * exact original substring. Built by walking marked's own token list with a
 * running cursor, not by searching for each paragraph's text with indexOf —
 * that would find the wrong occurrence for two identical paragraphs. A
 * token's `raw` field reconstructs the source byte-for-byte
 * (tokens.map(t => t.raw).join('') === source), the same guarantee
 * commentRanges gives a caller wanting to splice a fix back into exactly
 * where a comment was. Only top-level tokens are walked — a list item or
 * blockquote's own paragraphs are never candidates, matching autofix's own
 * "only touch a self-contained block" rule for comments.
 *
 * @param {string} source
 * @returns {{pos: number, end: number, raw: string}[]}
 */
export function markdownParagraphRanges(source) {
  const tokens = marked.lexer(source)
  /** @type {{pos: number, end: number, raw: string}[]} */
  const out = []
  let pos = 0
  for (const token of tokens) {
    if (token.type === "paragraph") out.push({ pos, end: pos + token.raw.length, raw: token.raw })
    pos += token.raw.length
  }
  return out
}

/**
 * @param {any} node
 * @returns {boolean}
 */
function hasBlockDescendant(node) {
  for (const child of node.childNodes ?? []) {
    const tag = child.tagName?.toLowerCase()
    if (tag && BLOCK_TAGS.has(tag)) return true
    if (hasBlockDescendant(child)) return true
  }
  return false
}

/**
 * Every block-level leaf in an .html document's <body>: a BLOCK_TAGS element
 * with no BLOCK_TAGS descendant of its own, and not itself inside a
 * PROTECTED_TAGS element — the same elements extractProse never reads into, for
 * the same reason. Reads via parseHTMLWithLocations (utils.js), not the
 * happy-dom parseHTML the rest of this file's callers use to query documents,
 * because it is the one of the two that tracks source positions. That makes
 * each leaf's `raw`/`leading`/`trailing`/`inner` a direct slice of the original
 * source, never a re-serialization. Unlike a caller searching for a node's
 * re-rendered outerHTML, nothing here fails to round-trip through unusual
 * entities or quoting differences. A node inserted implicitly by the parser
 * during tree correction carries no location and is skipped, as does an element
 * with an implicit end tag (like `</p>`). Neither has a literal source range to
 * hand back.
 *
 * @param {string} source
 * @returns {{pos: number, end: number, raw: string, tag: string, leading: string, trailing: string, inner: string}[]}
 */
export function htmlLeafElementRanges(source) {
  const document = parseHTMLWithLocations(source)
  const body = findFirstByTag(document, "body")
  /** @type {{pos: number, end: number, raw: string, tag: string, leading: string, trailing: string, inner: string}[]} */
  const out = []
  /**
   * @param {any} node
   * @param {boolean} protectedAncestor
   */
  function walk(node, protectedAncestor) {
    for (const child of node.childNodes ?? []) {
      const tag = child.tagName?.toLowerCase()
      if (!tag) continue
      const childProtected = protectedAncestor || PROTECTED_TAGS.has(tag)
      const loc = child.sourceCodeLocation
      if (!protectedAncestor && BLOCK_TAGS.has(tag) && loc?.startTag && loc?.endTag && !hasBlockDescendant(child)) {
        out.push({
          pos: loc.startOffset,
          end: loc.endOffset,
          raw: source.slice(loc.startOffset, loc.endOffset),
          tag,
          leading: source.slice(loc.startOffset, loc.startTag.endOffset),
          trailing: source.slice(loc.endTag.startOffset, loc.endOffset),
          inner: source.slice(loc.startTag.endOffset, loc.endTag.startOffset),
        })
      }
      walk(child, childProtected)
    }
  }
  if (body) walk(body, false)
  return out
}
