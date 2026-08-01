// Shared between the prose-follows-the-language audit (real corpus
// documents under docs/) and language lint's file mode (an ad-hoc document,
// not yet part of the corpus — a README, a spec still being drafted). Both
// need the exact same answer to "what counts as checkable prose here," or a
// document could pass one and fail the other for reasons that have nothing
// to do with its actual prose.

import { marked } from "marked"

// Text no rule may be applied to, the same set the audit has always used: a
// code block is code, a quotation is quoted for a reason, and a
// knowledge-prompt is a record of what somebody typed.
export const PROTECTED_TAGS = new Set([
  "pre", "code", "script", "style",
  "q", "blockquote", "language-avoid",
  "knowledge-prompt", "plan-global-constraints", "language-fail",
])

// A block element ends with a newline, so two paragraphs do not run together
// into one sentence.
const BLOCK_TAGS = new Set(["p", "li", "div", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "dt", "dd", "figcaption"])

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
