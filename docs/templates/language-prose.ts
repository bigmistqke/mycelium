// Shared between the prose-follows-the-language audit (real corpus
// documents under docs/) and language lint's file mode (an ad-hoc document,
// not yet part of the corpus — a README, a spec still being drafted). Both
// need the exact same answer to "what counts as checkable prose here," or a
// document could pass one and fail the other for reasons that have nothing
// to do with its actual prose.

import { marked } from "marked"
import { parseHTMLWithLocations, findFirstByTag } from "../../src/utils.ts"

// Text no rule may be applied to, the same set the audit has always used: a
// code block is code, a quotation is quoted for a reason, and a
// knowledge-prompt is a record of what somebody typed.
export const PROTECTED_TAGS = new Set([
  "pre", "code", "script", "style",
  "q", "blockquote", "language-avoid",
  "notebook-prompt", "plan-global-constraints", "language-fail",
])

// A block element ends with a newline, so two paragraphs do not run together
// into one sentence. The leaf test autofix also finds a corpus HTML element it
// can safely rewrite and splice back. Any of these with none of these as a
// descendant is a self-contained unit. This follows the same "only touch a
// self-contained block" rule that already keeps a list item's own nested
// paragraphs out of markdown autofix.
export const BLOCK_TAGS = new Set(["p", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dt", "dd", "figcaption"])

export function extractProse(node: any): string {
  let out = ""
  for (const child of Array.from(node.childNodes) as any[]) {
    if (child.nodeType === 3) { out += child.textContent ?? ""; continue }
    const tag = child.tagName?.toLowerCase()
    if (!tag || PROTECTED_TAGS.has(tag)) continue
    out += extractProse(child)
    if (BLOCK_TAGS.has(tag)) out += "\n"
  }
  return out
}

// A rule reading markup queries a copy with every protected element already
// gone, the same guarantee the audit gives every rule over a real
// document. It cannot reach a code block, a recorded prompt, or a rule's
// own failing example, because those elements are not there to find.
export function stripProtected(node: any): any {
  const clone = node.cloneNode(true)
  for (const el of Array.from(clone.querySelectorAll([...PROTECTED_TAGS].join(",")))) (el as any).remove()
  return clone
}

// Real markdown, not a hand-rolled approximation of it. A first attempt at
// this (blank-line paragraphs, a regex per inline span) got the common cases
// right and a real one wrong on the first real document it ran against. A
// list item's text wrapped onto a continuation line with no marker of its
// own, which silently turned the whole list into one overlong paragraph.
// The marked library already gets wrapped list items, nested lists,
// blockquotes, tables, and every inline span right, which is exactly the
// class of bug a hand-rolled version keeps re-discovering one document at
// a time.
export function markdownToHtmlFragment(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

// One range per top-level markdown paragraph, in source order, with the
// exact original substring. Built by walking marked's own token list with a
// running cursor, not by searching for each paragraph's text with indexOf —
// that would find the wrong occurrence for two identical paragraphs. A
// token's `raw` field reconstructs the source byte-for-byte
// (tokens.map(t => t.raw).join('') === source), the same guarantee
// commentRanges gives a caller wanting to splice a fix back into exactly
// where a comment was. Only top-level tokens are walked — a list item or
// blockquote's own paragraphs are never candidates, matching autofix's own
// "only touch a self-contained block" rule for comments.
export function markdownParagraphRanges(source: string): { pos: number; end: number; raw: string }[] {
  const tokens = marked.lexer(source)
  const out: { pos: number; end: number; raw: string }[] = []
  let pos = 0
  for (const token of tokens) {
    if (token.type === "paragraph") out.push({ pos, end: pos + token.raw.length, raw: token.raw })
    pos += token.raw.length
  }
  return out
}

function hasBlockDescendant(node: any): boolean {
  for (const child of node.childNodes ?? []) {
    const tag = child.tagName?.toLowerCase()
    if (tag && BLOCK_TAGS.has(tag)) return true
    if (hasBlockDescendant(child)) return true
  }
  return false
}

// Every block-level leaf in an .html document's <body>: a BLOCK_TAGS element
// with no BLOCK_TAGS descendant of its own, and not itself inside a
// PROTECTED_TAGS element — the same elements extractProse never reads into, for
// the same reason. Reads via parseHTMLWithLocations (utils.ts), not the
// happy-dom parseHTML the rest of this file's callers use to query documents,
// because it is the one of the two that tracks source positions. That makes
// each leaf's `raw`/`leading`/`trailing`/`inner` a direct slice of the original
// source, never a re-serialization. Unlike a caller searching for a node's
// re-rendered outerHTML, nothing here fails to round-trip through unusual
// entities or quoting differences. A node inserted implicitly by the parser
// during tree correction carries no location and is skipped, as does an element
// with an implicit end tag (like `</p>`). Neither has a literal source range to
// hand back.
export function htmlLeafElementRanges(
  source: string,
): { pos: number; end: number; raw: string; tag: string; leading: string; trailing: string; inner: string }[] {
  const document = parseHTMLWithLocations(source)
  const body = findFirstByTag(document, "body")
  const out: { pos: number; end: number; raw: string; tag: string; leading: string; trailing: string; inner: string }[] = []
  function walk(node: any, protectedAncestor: boolean) {
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
