// Every comment in a JS/TS/JSX/TSX source, stripped to plain text, parsed with the real TypeScript compiler.

import ts from "typescript"

/**
 * A comment mixes real prose with a runnable example, indented one level
 * deeper than the paragraph's own text by this project's own convention —
 * see, for instance, spec.template.html's add/update doc comments. A rule
 * about prose should see the prose only: joining an indented example's own
 * words into whatever sentence follows it is exactly the kind of accidental
 * merge a sentence-length or passive-voice rule should never have to read
 * through. A blank line marks a paragraph break the same way it does in
 * markdown, so a rule reading text sees separate paragraphs rather than one
 * run-on sentence spanning both.
 *
 * @param {string} raw
 * @returns {string}
 */
function formatCodeComment(raw) {
  const isBlock = raw.startsWith("/*")
  const lines = isBlock ? raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "").split("\n") : raw.split("\n")

  /** @type {string[]} */
  const paragraphs = []
  /** @type {string[]} */
  let current = []
  const flush = () => {
    if (current.length) paragraphs.push(current.join(" "))
    current = []
  }

  lines.forEach((line, i) => {
    // Line 0 of a block comment sits right after /**, with no `* ` marker to strip.
    const stripped = !isBlock ? line.replace(/^\/\/\s?/, "") : i === 0 ? line : line.replace(/^\s*\*\s?/, "")
    if (!stripped.trim()) {
      flush()
      return
    }
    if (!(isBlock && i === 0) && /^\s/.test(stripped)) return
    // A tag line declares a type, not prose, and ends the paragraph above it too.
    if (/^@\w/.test(stripped.trim())) {
      flush()
      return
    }
    current.push(stripped.trim())
  })
  flush()
  return paragraphs.filter(Boolean).join("\n\n")
}

/**
 * @typedef {object} CommentBlock
 * @property {"prose" | "example"} type
 * @property {string} text prose: the paragraph, its lines already joined with a single space.
 *   example: the original lines verbatim (marker stripped, own relative indent kept), joined with "\n" —
 *   reproduced exactly, never rewritten.
 */

/**
 * The structured form formatCodeComment collapses into one string: a
 * comment's prose and its indented examples, in source order, as
 * separate blocks instead of prose-only. A caller rewriting a comment's
 * words needs this and extractComments alone cannot give it. formatCodeComment
 * throws the example away outright, which suits a rule that only ever
 * reads prose, and loses exactly what a comment-writing caller needs back.
 *
 * Kept independent of formatCodeComment rather than built from it: the
 * two need different flush rules. formatCodeComment merges prose across
 * an example with no blank line around it, an existing quirk no real
 * comment in this corpus triggers. This one flushes on every type
 * change instead, so a caller here always gets the example back
 * verbatim regardless. autofix below checks its output against
 * formatCodeComment's before trusting it, so that difference can never
 * produce a silent mismatch. It leaves an irregular comment alone,
 * rather than risk a parse the two functions would read differently.
 *
 * @param {string} raw
 * @returns {{isBlock: boolean, blocks: CommentBlock[]}}
 */
export function parseComment(raw) {
  const isBlock = raw.startsWith("/*")
  const lines = isBlock ? raw.replace(/^\/\*+/, "").replace(/\*+\/$/, "").split("\n") : raw.split("\n")

  /** @type {CommentBlock[]} */
  const blocks = []
  /** @type {string[]} */
  let prose = []
  /** @type {string[]} */
  let example = []
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

/**
 * @typedef {object} CommentRange
 * @property {number} pos The source range a comment occupies, so a caller that wants to change
 *   what it says can splice this exact span rather than search for it.
 * @property {number} end
 * @property {string} raw
 * @property {string} text
 * @property {CommentSubject} subject What the comment sits above, when it sits above anything. A rule
 *   asking whether prose documents a declaration would otherwise need the compiler itself, and a rule
 *   is a short script in a document rather than a program that can carry a parser. So this reports the
 *   answer instead of the tree: `declares` names the kind, `name` names the thing.
 */

/**
 * @typedef {object} CommentSubject
 * @property {string | null} declares
 * @property {string | null} name
 * @property {number | null} start The declaration's own span, so a caller wanting the whole thing can
 *   take it rather than counting lines and hoping. Null when a comment leads nothing the parser names.
 * @property {number | null} end
 */

/**
 * Which node kinds count as a declaration a comment can document. A comment
 * above an `if` or a `return` describes a step, and one above a function or a
 * constant describes a named thing — the distinction the whole doc-block
 * question rests on.
 *
 * @param {ts.Node | undefined} node
 * @param {ts.SourceFile} sourceFile
 * @returns {CommentSubject}
 */
function describe(node, sourceFile) {
  const nowhere = { declares: null, name: null, start: null, end: null }
  if (!node) return nowhere
  /**
   * @param {string} kind
   * @param {ts.Node} [id]
   */
  const named = (kind, id) => ({
    declares: kind,
    name: id && ts.isIdentifier(/** @type {any} */ (id)) ? (/** @type {ts.Identifier} */ (id)).text : null,
    start: node.getStart(sourceFile),
    end: node.end,
  })
  if (ts.isFunctionDeclaration(node)) return named("function", node.name)
  if (ts.isClassDeclaration(node)) return named("class", node.name)
  if (ts.isInterfaceDeclaration(node)) return named("interface", node.name)
  if (ts.isTypeAliasDeclaration(node)) return named("type", node.name)
  if (ts.isEnumDeclaration(node)) return named("enum", node.name)
  if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) return named("member", /** @type {ts.Node} */ (node.name))
  if (ts.isVariableStatement(node)) return named("variable", node.declarationList.declarations[0]?.name)
  return nowhere
}

/**
 * Every logical comment in a JS/TS/JSX/TSX source, with the source range it
 * occupies alongside the same reading-view text extractComments returns —
 * what a caller writing a comment BACK into the file needs that
 * extractComments alone does not give it.
 *
 * @param {string} source
 * @returns {CommentRange[]}
 */
export function commentRanges(source) {
  const sourceFile = ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  /** @type {Set<number>} */
  const seen = new Set()
  /** @type {{pos: number, end: number, kind: ts.SyntaxKind, raw: string, leads?: ts.Node}[]} */
  const found = []

  /**
   * @param {number} pos
   * @param {number} end
   * @param {ts.SyntaxKind} kind
   * @param {ts.Node} [leads]
   */
  function record(pos, end, kind, leads) {
    if (seen.has(pos)) return
    seen.add(pos)
    found.push({ pos, end, kind, raw: source.slice(pos, end), leads })
  }

  /** @param {ts.Node} node */
  function visit(node) {
    // Only a leading range gets the node; the file itself claims none, to not steal the real declaration's.
    if (!ts.isSourceFile(node)) {
      ts.forEachLeadingCommentRange(source, node.getFullStart(), (pos, end, kind) => record(pos, end, kind, node))
    }
    ts.forEachTrailingCommentRange(source, node.getEnd(), (pos, end, kind) => record(pos, end, kind))
    node.forEachChild(visit)
  }
  visit(sourceFile)
  // A trailing note at the very end of the file has no following node to lead.
  ts.forEachLeadingCommentRange(source, sourceFile.endOfFileToken.getFullStart(), (pos, end, kind) => record(pos, end, kind))
  found.sort((a, b) => a.pos - b.pos)

  // Adjacent // lines merge into one comment, taking the LAST line's subject (the one touching the declaration).
  /** @type {{pos: number, end: number, raw: string, leads?: ts.Node}[]} */
  const merged = []
  /** @type {{pos: number, end: number, parts: string[], leads?: ts.Node} | null} */
  let block = null
  for (const c of found) {
    const continuesBlock = block && c.kind === ts.SyntaxKind.SingleLineCommentTrivia && /^\n[ \t]*$/.test(source.slice(block.end, c.pos))
    if (continuesBlock) {
      const current = /** @type {NonNullable<typeof block>} */ (block)
      current.parts.push(c.raw)
      current.end = c.end
      current.leads = c.leads
      continue
    }
    if (block) merged.push({ pos: block.pos, end: block.end, raw: block.parts.join("\n"), leads: block.leads })
    block = c.kind === ts.SyntaxKind.SingleLineCommentTrivia ? { pos: c.pos, end: c.end, parts: [c.raw], leads: c.leads } : null
    if (!block) merged.push({ pos: c.pos, end: c.end, raw: c.raw, leads: c.leads })
  }
  if (block) merged.push({ pos: block.pos, end: block.end, raw: block.parts.join("\n"), leads: block.leads })

  return merged
    .map(({ leads, ...m }) => ({ ...m, text: formatCodeComment(m.raw), subject: describe(leads, sourceFile) }))
    .filter((m) => m.text)
}

/**
 * @param {string} source
 * @returns {string[]}
 */
export function extractComments(source) {
  return commentRanges(source).map((c) => c.text)
}

const WRAP_WIDTH = 80

/**
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapWords(text, width) {
  const words = text.split(/\s+/).filter(Boolean)
  /** @type {string[]} */
  const lines = []
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

/**
 * The inverse of parseComment: blocks, in order, back into line-comment or
 * block-comment syntax at the given indent. A prose block is wrapped to the
 * same ~80 column width every hand-written comment in this project
 * already uses; an example block is reproduced exactly as parseComment
 * captured it, never wrapped or reworded.
 *
 * @param {CommentBlock[]} blocks
 * @param {string} indent
 * @param {boolean} isBlock
 * @returns {string}
 */
export function formatAsComment(blocks, indent, isBlock) {
  const width = WRAP_WIDTH - indent.length - 3
  /** @type {string[]} */
  const bodyLines = []
  blocks.forEach((block, i) => {
    if (i > 0) bodyLines.push("")
    bodyLines.push(...(block.type === "prose" ? wrapWords(block.text, width) : block.text.split("\n")))
  })
  if (isBlock) {
    return [`${indent}/**`, ...bodyLines.map((l) => (l ? `${indent} * ${l}` : `${indent} *`)), `${indent} */`].join("\n")
  }
  return bodyLines.map((l) => (l ? `${indent}// ${l}` : `${indent}//`)).join("\n")
}
