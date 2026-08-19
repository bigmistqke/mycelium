// Shared across template-embedded command scripts — importable now that
// script-hooks.ts gives every embedded <script> a real file: identity
// instead of a data: URL. This is the first real instance of the sharing
// docs/knowledge/2026-07-24-duplicate-not-share-loadcheck.decision.html
// declined at a much smaller scale. That decision's own stated reason
// ("a data: URL-loaded command script can't do a relative import
// anyway") no longer holds once the script itself loads from a real
// file: URL. See .mycelium/specs/2026-07-25-virtual-module-script-imports.spec.html.

import ts from "typescript"

export function todayDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The tags a type declares, in the order it declares them.
 *
 * Reads the shape out of the template rather than repeating it, so a field
 * added to a template needs no second edit here.
 */
export function declaredOrder(templateDoc: Document, typeId: string): string[] {
  const tpl = templateDoc.querySelector(`template[id="${typeId}"]`) as HTMLTemplateElement | null
  const shape = tpl?.content?.firstElementChild
  return shape ? Array.from(shape.children).map((c) => c.tagName.toLowerCase()) : []
}

/**
 * Every type a template file declares, mapped to the order of its fields.
 *
 * A family nesting several types needs all of them at once, and reading them
 * together means a command never names its own types in code.
 */
export function declaredOrders(templateDoc: Document): Map<string, string[]> {
  const orders = new Map<string, string[]>()
  for (const tpl of Array.from(templateDoc.querySelectorAll("template[id]"))) {
    const id = tpl.getAttribute("id")!
    orders.set(id, declaredOrder(templateDoc, id))
  }
  return orders
}

/**
 * Puts a new field where its template declares it, rather than last.
 *
 * Appending records which flag arrived when. Two nodes saying the same thing
 * then serialize differently, and 31 nodes in this corpus drifted that way,
 * one `update` at a time. It also blocks enforcing the declared order later,
 * since every node an update had touched would fail.
 *
 * A tag the template does not declare keeps its place. An edge or a script
 * never moves, and declared fields only ever move relative to each other.
 */
export function placeField(root: Element, el: Element, order: string[]): void {
  const rank = order.indexOf(el.tagName.toLowerCase())
  const later =
    rank < 0
      ? null
      : Array.from(root.children).find((c) => order.indexOf(c.tagName.toLowerCase()) > rank)
  root.insertBefore(el, later ?? null)
}

/**
 * Whether a document declares types rather than making claims.
 *
 * An instance inside one demonstrates its type and asserts nothing about the
 * system, so anything counting or drawing the corpus skips it. Nothing marks
 * one: the document it sits in says so, and a marker would be a hand-written
 * copy of that with somewhere to forget it.
 *
 * validate still checks every worked example, since conforming is half their
 * job. This answers a different question.
 */
export function declaresATemplate(doc: Document): boolean {
  return doc.querySelector("template[id]") !== null
}

// Every command a source EXPORTS, with the opening sentence of its doc
// comment — the same reading printRoster does over `mycelium --help`, so a
// page drawing the corpus can show a family's commands without repeating
// that parse. Parsed with the real TypeScript compiler rather than a regex
// so `export async function`, arrow-function exports, and reordered or
// reformatted commands are all still picked up correctly.
function parseCommandSource(source: string): ts.SourceFile {
  return ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
}

function hasExportModifier(node: ts.Node): boolean {
  return !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
}

function exportedFunctionNames(stmt: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt) && stmt.name) return [stmt.name.text]
  // `export { addCase as case }`. A family names its commands after the
  // types it declares, and a type is free to be called something
  // JavaScript reserves as a keyword. The alias is the name the command
  // line uses, so the alias is the name this reads.
  if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
    return stmt.exportClause.elements.map((element) => element.name.text)
  }
  if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) return []
  return stmt.declarationList.declarations
    .filter((d) => ts.isIdentifier(d.name) && !!d.initializer && (ts.isFunctionExpression(d.initializer) || ts.isArrowFunction(d.initializer)))
    .map((d) => (d.name as ts.Identifier).text)
}

function formatComment(raw: string): string {
  return raw
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)))
    .join("\n")
}

// The nearest block comment (JSDoc or plain) immediately preceding a node.
function leadingBlockComment(source: string, node: ts.Node): string | undefined {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart())
  const doc = ranges?.filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia).pop()
  return doc ? source.slice(doc.pos, doc.end) : undefined
}

// The opening sentence of a doc comment, as one line. Not its first LINE:
// these comments are hand-wrapped at roughly 72 columns, so a first line is
// as likely to end mid-clause as at a sentence boundary. Joins the leading
// paragraph back into one line and cuts at the first sentence-ending
// period, falling back to a hard truncation for a comment with none.
const SUMMARY_MAX = 76

function firstSentence(doc: string): string {
  const lines: string[] = []
  for (const line of doc.split("\n")) {
    if (!line.trim()) break
    lines.push(line.trim())
  }
  const paragraph = lines.join(" ")
  const end = /\.(\s|$)/.exec(paragraph)
  const sentence = end ? paragraph.slice(0, end.index + 1) : paragraph
  return sentence.length > SUMMARY_MAX ? sentence.slice(0, SUMMARY_MAX - 1).trimEnd() + "…" : sentence
}

export function readCommands(source: string): { name: string; summary: string }[] {
  const sourceFile = parseCommandSource(source)
  const commands: { name: string; summary: string }[] = []

  for (const stmt of sourceFile.statements) {
    const names = exportedFunctionNames(stmt)
    if (names.length === 0) continue
    const doc = leadingBlockComment(source, stmt)
    for (const name of names) commands.push({ name, summary: doc ? firstSentence(formatComment(doc)) : "" })
  }
  return commands
}
