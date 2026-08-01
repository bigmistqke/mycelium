// Every comment in a JS/TS/JSX/TSX source, as plain text with the comment
// syntax already stripped, so a language rule sees the same shape of prose
// whether it came from a comment or from a paragraph.
//
// Parses with the real TypeScript compiler rather than a hand-rolled scanner.
// A first attempt scanned tokens directly and mis-happened to trigger inside
// a template literal's `${...}` interpolation, since a flat token scan does
// not know to re-enter template-literal mode after the interpolated
// expression the way a real parser does. The compiler already gets this
// right, because it has to, to parse the file at all.
//
// Every file is parsed as ScriptKind.TSX regardless of its real extension.
// TSX is a strict superset of what plain JS, JSX, or non-JSX TS actually
// contains, with exactly one exception this project's own code never uses:
// the `<Type>value` angle-bracket cast. It is ambiguous with a JSX element
// and rejected in a .tsx file, where `value as Type` is required instead.
// This project already writes `as Type` everywhere, so always parsing in
// the mode that also accepts JSX costs nothing here.

import ts from "typescript"

// A comment mixes real prose with a runnable example, indented one level
// deeper than the paragraph's own text by this project's own convention —
// see, for instance, spec.template.html's add/update doc comments. A rule
// about prose should see the prose only: joining an indented example's own
// words into whatever sentence follows it is exactly the kind of accidental
// merge a sentence-length or passive-voice rule should never have to read
// through. A blank line marks a paragraph break the same way it does in
// markdown, so a rule reading text sees separate paragraphs rather than one
// run-on sentence spanning both.
function formatCodeComment(raw: string): string {
  const isBlock = raw.startsWith("/*")
  const lines = isBlock ? raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "").split("\n") : raw.split("\n")

  const paragraphs: string[] = []
  let current: string[] = []
  const flush = () => {
    if (current.length) paragraphs.push(current.join(" "))
    current = []
  }

  lines.forEach((line, i) => {
    // The very first line of a block comment sits directly after /**, with
    // no per-line `* ` marker of its own to strip — every other line has one.
    const stripped = !isBlock ? line.replace(/^\/\/\s?/, "") : i === 0 ? line : line.replace(/^\s*\*\s?/, "")
    if (!stripped.trim()) {
      flush()
      return
    }
    if (!(isBlock && i === 0) && /^\s/.test(stripped)) return
    current.push(stripped.trim())
  })
  flush()
  return paragraphs.filter(Boolean).join("\n\n")
}

export function extractComments(source: string): string[] {
  const sourceFile = ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const seen = new Set<number>()
  const found: { pos: number; end: number; kind: ts.SyntaxKind; raw: string }[] = []

  function record(pos: number, end: number, kind: ts.SyntaxKind) {
    if (seen.has(pos)) return
    seen.add(pos)
    found.push({ pos, end, kind, raw: source.slice(pos, end) })
  }

  function visit(node: ts.Node) {
    ts.forEachLeadingCommentRange(source, node.getFullStart(), record)
    ts.forEachTrailingCommentRange(source, node.getEnd(), record)
    node.forEachChild(visit)
  }
  visit(sourceFile)
  // A comment after the very last real token (a trailing note at the end of
  // a file) has no following node to be a leading comment of.
  ts.forEachLeadingCommentRange(source, sourceFile.endOfFileToken.getFullStart(), record)
  found.sort((a, b) => a.pos - b.pos)

  // A person reads a run of adjacent // lines as one paragraph; the
  // compiler's own comment ranges do not know that, and hand back each line
  // as its own separate range. Merged here whenever nothing but a single
  // line break sits between one and the next, so a sentence this project
  // wrapped across two // lines gets checked as the one sentence it is.
  const merged: string[] = []
  let block: { end: number; parts: string[] } | null = null
  for (const c of found) {
    const continuesBlock = block && c.kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\n[ \t]*$/.test(source.slice(block.end, c.pos))
    if (continuesBlock) {
      block!.parts.push(c.raw)
      block!.end = c.end
      continue
    }
    if (block) merged.push(block.parts.join("\n"))
    block = c.kind === ts.SyntaxKind.SingleLineCommentTrivia ? { end: c.end, parts: [c.raw] } : null
    if (!block) merged.push(c.raw)
  }
  if (block) merged.push(block.parts.join("\n"))

  return merged.map(formatCodeComment).filter(Boolean)
}
