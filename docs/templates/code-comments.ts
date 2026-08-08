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
    // A JSDoc tag line declares a type, and a type is not prose. Left in, a
    // @typedef listing eight properties reads to a rule as one sixty-word
    // sentence, and a @returns naming something thrown reads as passive voice.
    // Neither is a sentence anybody wrote or can reword.
    //
    // A tag ends the paragraph before it as well. Prose above a tag block is
    // ordinary prose and stays checked; the tags below it are a separate thing
    // and do not join on to it.
    if (/^@\w/.test(stripped.trim())) {
      flush()
      return
    }
    current.push(stripped.trim())
  })
  flush()
  return paragraphs.filter(Boolean).join("\n\n")
}

export interface CommentBlock {
  type: "prose" | "example"
  // prose: the paragraph, its lines already joined with a single space.
  // example: the original lines verbatim (marker stripped, own relative
  // indent kept), joined with "\n" — reproduced exactly, never rewritten.
  text: string
}

// The structured form formatCodeComment collapses into one string: a
// comment's prose and its indented examples, in source order, as
// separate blocks instead of prose-only. A caller rewriting a comment's
// words needs this and extractComments alone cannot give it. formatCodeComment
// throws the example away outright, which suits a rule that only ever
// reads prose, and loses exactly what a comment-writing caller needs back.
//
// Kept independent of formatCodeComment rather than built from it: the
// two need different flush rules. formatCodeComment merges prose across
// an example with no blank line around it, an existing quirk no real
// comment in this corpus triggers. This one flushes on every type
// change instead, so a caller here always gets the example back
// verbatim regardless. autofix below checks its output against
// formatCodeComment's before trusting it, so that difference can never
// produce a silent mismatch. It leaves an irregular comment alone,
// rather than risk a parse the two functions would read differently.
export function parseComment(raw: string): { isBlock: boolean; blocks: CommentBlock[] } {
  const isBlock = raw.startsWith("/*")
  const lines = isBlock ? raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "").split("\n") : raw.split("\n")

  const blocks: CommentBlock[] = []
  let prose: string[] = []
  let example: string[] = []
  const flushProse = () => {
    if (prose.length) blocks.push({ type: "prose", text: prose.join(" ") })
    prose = []
  }
  const flushExample = () => {
    if (example.length) blocks.push({ type: "example", text: example.join("\n") })
    example = []
  }

  lines.forEach((line, i) => {
    const stripped = !isBlock ? line.replace(/^\/\/\s?/, "") : i === 0 ? line : line.replace(/^\s*\*\s?/, "")
    if (!stripped.trim()) {
      flushProse()
      flushExample()
      return
    }
    if (!(isBlock && i === 0) && /^\s/.test(stripped)) {
      flushProse()
      example.push(stripped)
      return
    }
    flushExample()
    prose.push(stripped.trim())
  })
  flushProse()
  flushExample()
  return { isBlock, blocks }
}

export interface CommentRange {
  // The source range a comment occupies, so a caller that wants to change
  // what it says can splice this exact span rather than search for it.
  pos: number
  end: number
  raw: string
  text: string
  // What the comment sits above, when it sits above anything. A rule asking
  // whether prose documents a declaration would otherwise need the compiler
  // itself, and a rule is a short script in a document rather than a program
  // that can carry a parser. So this reports the answer instead of the tree:
  // `declares` names the kind, `name` names the thing.
  subject: CommentSubject
}

export interface CommentSubject {
  declares: string | null
  name: string | null
}

// A leaf test: `it` or `test`, including the forms that wear a modifier. The
// leftmost identifier of the callee decides, so `it.only` and `test.skip`
// answer the same as a bare call.
//
// A group such as `describe` is deliberately absent. A group is navigation: it
// spans a whole file and asserts nothing itself, so naming it as a documented
// subject invites a comment that has to speak for every child at once.
const TEST_CALLS = new Set(["it", "test"])

function calleeRoot(node: ts.Expression): string | null {
  let current: ts.Node = node
  while (true) {
    if (ts.isIdentifier(current)) return current.text
    if (ts.isPropertyAccessExpression(current) || ts.isCallExpression(current)) {
      current = current.expression
      continue
    }
    return null
  }
}

// Which node kinds count as a declaration a comment can document. A comment
// above an `if` or a `return` describes a step, and one above a function or a
// constant describes a named thing — the distinction the whole doc-block
// question rests on.
//
// A test is the one subject here that no declaration keyword introduces. It is
// a call, and its name is a string rather than an identifier. The derivation
// chain rests on that case: a test owns no document and joins the chain only
// through the comment sitting above it, so anything asking what a comment
// documents has to be able to answer "the test called …".
function describe(node: ts.Node | undefined): CommentSubject {
  if (!node) return { declares: null, name: null }
  const named = (kind: string, id?: ts.Node) => ({ declares: kind, name: id && ts.isIdentifier(id as any) ? (id as ts.Identifier).text : null })
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
    const root = calleeRoot(node.expression.expression)
    if (root && TEST_CALLS.has(root)) {
      const first = node.expression.arguments[0]
      return { declares: "test", name: first && ts.isStringLiteralLike(first) ? first.text : null }
    }
  }
  if (ts.isFunctionDeclaration(node)) return named("function", node.name)
  if (ts.isClassDeclaration(node)) return named("class", node.name)
  if (ts.isInterfaceDeclaration(node)) return named("interface", node.name)
  if (ts.isTypeAliasDeclaration(node)) return named("type", node.name)
  if (ts.isEnumDeclaration(node)) return named("enum", node.name)
  if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) return named("member", node.name as ts.Node)
  if (ts.isVariableStatement(node)) return named("variable", node.declarationList.declarations[0]?.name)
  return { declares: null, name: null }
}

// Every logical comment in a JS/TS/JSX/TSX source, with the source range it
// occupies alongside the same reading-view text extractComments returns —
// what a caller writing a comment BACK into the file needs that
// extractComments alone does not give it.
export function commentRanges(source: string): CommentRange[] {
  const sourceFile = ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const seen = new Set<number>()
  const found: { pos: number; end: number; kind: ts.SyntaxKind; raw: string; leads?: ts.Node }[] = []

  function record(pos: number, end: number, kind: ts.SyntaxKind, leads?: ts.Node) {
    if (seen.has(pos)) return
    seen.add(pos)
    found.push({ pos, end, kind, raw: source.slice(pos, end), leads })
  }

  function visit(node: ts.Node) {
    // Only a LEADING range gets the node: a comment before something introduces
    // it, and a comment after something on the same line is an aside about the
    // line it trails. Handing the node to both would report a trailing note as
    // documentation of whatever came before it.
    ts.forEachLeadingCommentRange(source, node.getFullStart(), (pos, end, kind) => record(pos, end, kind, node))
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
  // A merged run of // lines takes the subject of its LAST line, since that is
  // the one actually touching the declaration. Taking the first would report
  // the run as introducing whatever the first line happened to precede.
  const merged: { pos: number; end: number; raw: string; leads?: ts.Node }[] = []
  let block: { pos: number; end: number; parts: string[]; leads?: ts.Node } | null = null
  for (const c of found) {
    const continuesBlock = block && c.kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\n[ \t]*$/.test(source.slice(block.end, c.pos))
    if (continuesBlock) {
      block!.parts.push(c.raw)
      block!.end = c.end
      block!.leads = c.leads
      continue
    }
    if (block) merged.push({ pos: block.pos, end: block.end, raw: block.parts.join("\n"), leads: block.leads })
    block = c.kind === ts.SyntaxKind.SingleLineCommentTrivia ? { pos: c.pos, end: c.end, parts: [c.raw], leads: c.leads } : null
    if (!block) merged.push({ pos: c.pos, end: c.end, raw: c.raw, leads: c.leads })
  }
  if (block) merged.push({ pos: block.pos, end: block.end, raw: block.parts.join("\n"), leads: block.leads })

  return merged
    .map(({ leads, ...m }) => ({ ...m, text: formatCodeComment(m.raw), subject: describe(leads) }))
    .filter((m) => m.text)
}

export function extractComments(source: string): string[] {
  return commentRanges(source).map((c) => c.text)
}

export interface TestRange {
  name: string | null
  // The comment sitting directly above, when there is one.
  comment: CommentRange | null
}

// Every leaf test in a source, whether or not a comment sits above it.
//
// commentRanges cannot answer this. It enumerates comments and reports what
// each one sits above, so a test carrying no comment never appears in its
// output. That absence is the exact case a check about missing citations
// exists to catch. Asking the question the other way round is a different
// walk, so it is a different function, sharing the one definition of what
// counts as a test.
export function testRanges(source: string): TestRange[] {
  const comments = commentRanges(source)
  const sourceFile = ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const tests: TestRange[] = []

  function visit(node: ts.Node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const root = calleeRoot(node.expression.expression)
      if (root && TEST_CALLS.has(root)) {
        const first = node.expression.arguments[0]
        // The comment inside this statement's own leading trivia, which is the
        // same one describe() already attributed to it. Matching on the span
        // rather than on the test's name keeps two tests worded alike apart.
        const start = node.getStart(sourceFile)
        const comment = comments.find((c) => c.subject.declares === "test" && c.pos >= node.pos && c.end <= start)
        tests.push({ name: first && ts.isStringLiteralLike(first) ? first.text : null, comment: comment ?? null })
      }
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return tests
}

const WRAP_WIDTH = 80

function wrapWords(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && next.length > width) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

// The inverse of parseComment: blocks, in order, back into `//` or
// `/** */` syntax at the given indent. A prose block is wrapped to the
// same ~80 column width every hand-written comment in this project
// already uses; an example block is reproduced exactly as parseComment
// captured it, never wrapped or reworded.
export function formatAsComment(blocks: CommentBlock[], indent: string, isBlock: boolean): string {
  const width = WRAP_WIDTH - indent.length - 3
  const bodyLines: string[] = []
  blocks.forEach((block, i) => {
    if (i > 0) bodyLines.push("")
    bodyLines.push(...(block.type === "prose" ? wrapWords(block.text, width) : block.text.split("\n")))
  })
  if (isBlock) {
    return [`${indent}/**`, ...bodyLines.map((l) => (l ? `${indent} * ${l}` : `${indent} *`)), `${indent} */`].join("\n")
  }
  return bodyLines.map((l) => (l ? `${indent}// ${l}` : `${indent}//`)).join("\n")
}
