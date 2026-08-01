// Shared between the prose-follows-the-language audit (real corpus
// documents under docs/) and language lint's file mode (an ad-hoc document,
// not yet part of the corpus — a README, a spec still being drafted). Both
// need the exact same answer to "what counts as checkable prose here," or a
// document could pass one and fail the other for reasons that have nothing
// to do with its actual prose.

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
// gone, the same guarantee the audit gives every rule over a real document:
// it cannot reach a code block, a recorded prompt, or a rule's own failing
// example, because those elements are not there to find.
export function stripProtected(node: any): any {
  const clone = node.cloneNode(true)
  for (const el of Array.from(clone.querySelectorAll([...PROTECTED_TAGS].join(",")))) (el as any).remove()
  return clone
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

// Inline spans a rule about markup needs to see as real elements: a backtick
// span becomes <code>, so PROTECTED_TAGS excludes it exactly like a real
// corpus document's <code>; **bold**/__bold__ becomes <strong>, so a
// mini-headline opener is a real element the same rule already looks for.
function inlineMarkdown(line: string): string {
  return escapeHtml(line)
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
}

// Just enough of markdown for the two rules that need real markup — a <p>
// per paragraph so paragraph-length can count sentences, a heading and a
// list item each on their own line the same way an audit's BLOCK_TAGS keeps
// them from running into a neighbor — not a renderer. Links, tables, nested
// lists, and every other construct are deliberately left as literal text:
// nothing here renders, it only has to look like the HTML the rules were
// built against.
export function markdownToHtmlFragment(markdown: string): string {
  const blocks = markdown.split(/\n{2,}/)
  const out: string[] = []
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    if (trimmed.startsWith("```")) {
      out.push(`<pre><code>${escapeHtml(trimmed)}</code></pre>`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed)
    if (heading) {
      out.push(`<h2>${inlineMarkdown(heading[2])}</h2>`)
      continue
    }
    // A table row or separator is not prose; a blank result contributes
    // nothing to either a rule reading text or one reading markup.
    if (trimmed.startsWith("|")) continue

    const lines = trimmed.split("\n")
    if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
      for (const line of lines) {
        const item = line.replace(/^\s*([-*]|\d+\.)\s+/, "")
        out.push(`<li>${inlineMarkdown(item)}</li>`)
      }
      continue
    }

    out.push(`<p>${inlineMarkdown(block.replace(/\n/g, " "))}</p>`)
  }
  return out.join("\n")
}
