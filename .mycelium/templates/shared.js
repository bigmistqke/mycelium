// Shared across template-embedded command scripts, each of which now has a real file: identity to import by.

import ts from "typescript"

/** @returns {string} */
export function todayDate() {
  const d = new Date()
  /** @param {number} n */
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The tags a type declares, in the order it declares them.
 *
 * Reads the shape out of the template rather than repeating it, so a field
 * added to a template needs no second edit here.
 *
 * @param {Document} templateDoc
 * @param {string} typeId
 * @returns {string[]}
 */
export function declaredOrder(templateDoc, typeId) {
  const tpl = /** @type {HTMLTemplateElement | null} */ (templateDoc.querySelector(`template[id="${typeId}"]`))
  const shape = tpl?.content?.firstElementChild
  return shape ? Array.from(shape.children).map((c) => c.tagName.toLowerCase()) : []
}

/**
 * Every type a template file declares, mapped to the order of its fields.
 *
 * A family nesting several types needs all of them at once, and reading them
 * together means a command never names its own types in code.
 *
 * @param {Document} templateDoc
 * @returns {Map<string, string[]>}
 */
export function declaredOrders(templateDoc) {
  /** @type {Map<string, string[]>} */
  const orders = new Map()
  for (const tpl of Array.from(templateDoc.querySelectorAll("template[id]"))) {
    const id = /** @type {string} */ (tpl.getAttribute("id"))
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
 *
 * @param {Element} root
 * @param {Element} el
 * @param {string[]} order
 * @returns {void}
 */
export function placeField(root, el, order) {
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
 *
 * @param {Document} doc
 * @returns {boolean}
 */
export function declaresATemplate(doc) {
  return doc.querySelector("template[id]") !== null
}

/**
 * Every command a source EXPORTS, with its full verb path and the opening
 * sentence of its doc comment — the same reading printHelp/printRoster do
 * over `mycelium --help`, so a page drawing the corpus can show a family's
 * commands without repeating that parse. Parsed with the real TypeScript
 * compiler rather than a regex so `export async function`, arrow-function
 * exports, and reordered or reformatted commands are all still picked up
 * correctly.
 *
 * @param {string} source
 * @returns {ts.SourceFile}
 */
function parseCommandSource(source) {
  return ts.createSourceFile("_.tsx", source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
}

/**
 * @param {ts.Node} node
 * @returns {boolean}
 */
function hasExportModifier(node) {
  return !!(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
}

/**
 * @param {string} raw
 * @returns {string}
 */
function formatComment(raw) {
  return raw
    .replace(/^\/\*+/, "")
    .replace(/\*+\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, "").trimEnd())
    .filter((line, i, arr) => !(line === "" && (i === 0 || i === arr.length - 1)))
    .join("\n")
}

/**
 * The nearest block comment (JSDoc or plain) immediately preceding a node,
 * formatted. Works the same whether the node is a top-level statement or a
 * method/property sitting inside an object literal — TypeScript's leading
 * trivia is positional, not statement-specific.
 *
 * @param {string} source
 * @param {ts.Node} node
 * @returns {string}
 */
function docFor(source, node) {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart())
  const range = ranges?.filter((r) => r.kind === ts.SyntaxKind.MultiLineCommentTrivia).pop()
  return range ? formatComment(source.slice(range.pos, range.end)) : ""
}

// Max length for firstSentence's own collapsed output.
const SUMMARY_MAX = 76

/**
 * @param {string} doc
 * @returns {string}
 */
function firstSentence(doc) {
  /** @type {string[]} */
  const lines = []
  for (const line of doc.split("\n")) {
    if (!line.trim()) break
    lines.push(line.trim())
  }
  const paragraph = lines.join(" ")
  const end = /\.(\s|$)/.exec(paragraph)
  const sentence = end ? paragraph.slice(0, end.index + 1) : paragraph
  return sentence.length > SUMMARY_MAX ? sentence.slice(0, SUMMARY_MAX - 1).trimEnd() + "…" : sentence
}

/**
 * @typedef {object} CommandEntry
 * @property {string[]} path The full verb path from the family's own name down to this leaf, e.g. `["experiment", "case", "add"]`.
 * @property {string} doc This leaf's own doc comment, or the nearest ancestor's if it has none of its own.
 * @property {string} summary
 */

/**
 * @param {ts.PropertyName} name
 * @returns {string | undefined}
 */
function propertyName(name) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

/**
 * @param {string[]} path
 * @param {string} doc
 * @returns {CommandEntry}
 */
function entryFor(path, doc) {
  return { path, doc, summary: doc ? firstSentence(doc) : "" }
}

/**
 * A command value is either callable — the leaf itself — or a further table
 * of verbs, the same shape `byVerb`'s own `verbs` argument used to have, just
 * written as a real export instead of rebuilt inside a function body:
 * `export const experiment = { add() {}, case: { add() {}, del() {} } }`.
 * A property with no doc comment of its own inherits the nearest ancestor's,
 * so a family whose rich usage doc sits once above the whole object still
 * shows it under every verb reached from there, and a verb that later gets
 * its own more specific comment overrides that inherited one.
 *
 * @param {string} source
 * @param {ts.Expression} expr
 * @param {string[]} path
 * @param {string} inherited
 * @param {CommandEntry[]} out
 * @returns {void}
 */
function walkCommandValue(source, expr, path, inherited, out) {
  // An inline function, or a bare reference to a named one declared elsewhere.
  if (ts.isFunctionExpression(expr) || ts.isArrowFunction(expr) || ts.isIdentifier(expr)) {
    out.push(entryFor(path, inherited))
    return
  }
  if (!ts.isObjectLiteralExpression(expr)) return
  for (const prop of expr.properties) {
    if (ts.isMethodDeclaration(prop) && prop.name) {
      const name = propertyName(prop.name)
      if (name) out.push(entryFor([...path, name], docFor(source, prop) || inherited))
    } else if (ts.isPropertyAssignment(prop) && prop.name) {
      const name = propertyName(prop.name)
      if (name) walkCommandValue(source, prop.initializer, [...path, name], docFor(source, prop) || inherited, out)
    }
  }
}

/**
 * @param {string} source
 * @returns {CommandEntry[]}
 */
export function readCommands(source) {
  const sourceFile = parseCommandSource(source)
  /** @type {CommandEntry[]} */
  const out = []

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt) && stmt.name) {
      out.push(entryFor([stmt.name.text], docFor(source, stmt)))
      continue
    }
    // `export { addCase as case }`: the alias is the name the command line uses, so it's the name this reads.
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const element of stmt.exportClause.elements) out.push(entryFor([element.name.text], ""))
      continue
    }
    if (!ts.isVariableStatement(stmt) || !hasExportModifier(stmt)) continue
    const doc = docFor(source, stmt)
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.initializer) walkCommandValue(source, decl.initializer, [decl.name.text], doc, out)
    }
  }
  return out
}
