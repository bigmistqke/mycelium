// Both ends of the specification/test joint: which behaviours the corpus states, and which each test checks.

/** @import { AuditFs } from "mycelium/api" */
import { commentRanges } from "mycelium/code-comments"

/**
 * @typedef {object} CanonEntry
 * @property {string} address
 * @property {string} title
 * @property {string} detail The reasoning under the claim, as the markup it carries. A title states a
 *   rule in one line and one line has no room for what it rules out, so a reader wanting the why needs
 *   this beside the graph rather than behind a link. Empty for a claim carrying none.
 * @property {string[]} dependsOn Where this entry points, already resolved to addresses. Stored edges
 *   point up only: a specification names the axioms it serves and an axiom names the one it narrows, so
 *   anything asking what sits beneath either computes it from these rather than reading an authored
 *   reverse index.
 */

/**
 * @typedef {object} Specification
 * @property {string} address
 * @property {string} title
 * @property {string} detail
 * @property {string[]} dependsOn
 * @property {Behaviour[]} behaviours
 * @property {string[]} specifies The files this subsystem answers for, already resolved. A specification
 *   points at code rather than naming a subsystem, so this link set is the whole of what the subsystem
 *   covers.
 */

/**
 * @typedef {object} Behaviour
 * @property {string} address
 * @property {string} title
 * @property {string} detail
 * @property {string[]} dependsOn
 * @property {string | null} parent The behaviour this one narrows, when it sits inside another. A claim
 *   made of narrower claims holds them, so the parent is where the markup puts it rather than an edge
 *   somebody wrote.
 * @property {string} check The check that falsifies this claim, as its own source. A leaf carries one; a
 *   claim proved by the ones beneath it carries an empty string. The source rather than a flag saying one
 *   exists. A claim is a sentence about the system and the check is the only thing that can argue with
 *   it, so anything showing a reader the claim has something to show them beside it.
 * @property {string} fixture The markup a browser case runs against, empty for every other claim. Half of
 *   what a browser case says lives here: an assertion about a row index means nothing without the boxes
 *   it counts rows over.
 */

/**
 * @typedef {object} Canon
 * @property {CanonEntry[]} axioms
 * @property {Specification[]} specifications
 */

/**
 * An address is a path from the repository root and an optional fragment,
 * written the one way, so a citation and a behaviour can be compared as
 * strings.
 *
 * Everything below builds one through here rather than by concatenating in
 * place.
 *
 * @param {string} path
 * @param {string | null} [fragment]
 * @returns {string}
 */
export function address(path, fragment) {
  return fragment ? `${path}#${fragment}` : path
}

/**
 * Resolves an href written inside `path` against the repository root, since a
 * document links relatively and an address does not.
 *
 * An href with no path is this same document, which is how a sample case points
 * at a sample behaviour beside it.
 *
 * @param {string} path
 * @param {string} href
 * @returns {string}
 */
export function resolveHref(path, href) {
  const hash = href.indexOf("#")
  const file = hash === -1 ? href : href.slice(0, hash)
  const fragment = hash === -1 ? "" : href.slice(hash + 1)
  if (!file) return address(path, fragment)
  const segments = path.split("/").slice(0, -1)
  for (const segment of file.split("/")) {
    if (segment === "." || segment === "") continue
    if (segment === "..") segments.pop()
    else segments.push(segment)
  }
  return address(segments.join("/"), fragment)
}

/**
 * @param {Element} element
 * @param {string} path
 * @param {string} [rel]
 * @returns {string[]}
 */
function edges(element, path, rel = "depends_on") {
  return Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === "a" && child.getAttribute("data-rel") === rel)
    .map((child) => resolveHref(path, child.getAttribute("href") ?? ""))
}

/**
 * One field of a claim, by tag name.
 *
 * Direct children only, everywhere, for the reason the behaviour validator
 * gives: a script belonging to a grandchild is that grandchild's proof and says
 * nothing about this claim.
 *
 * @param {Element} element
 * @param {string} tag
 * @returns {Element | undefined}
 */
function childOf(element, tag) {
  return Array.from(element.children).find((child) => child.tagName.toLowerCase() === tag)
}

/**
 * @param {Element} element
 * @returns {string}
 */
function titleOf(element) {
  return childOf(element, "canon-title")?.textContent?.trim() ?? ""
}

/**
 * A claim's own reasoning, as markup rather than text, since a detail holds
 * paragraphs.
 *
 * A parent showing a child's reasoning would put an argument under a heading it
 * never made, which is one of the reasons childOf looks no deeper.
 *
 * @param {Element} element
 * @returns {string}
 */
function detailOf(element) {
  return childOf(element, "canon-detail")?.innerHTML?.trim() ?? ""
}

/**
 * Every behaviour under one element, however deep, each carrying the claim it
 * narrows.
 *
 * Anything inside a canon-fixture is a worked example a check builds, not a
 * claim the project makes. A figure fixture holds figure elements and nobody
 * notices; a chain fixture holds canon elements, and counting those would put
 * an axiom nobody wrote in front of grounded.
 *
 * @param {Element} element
 * @param {string} path
 * @param {string | null} parent
 * @returns {Behaviour[]}
 */
function behavioursIn(element, path, parent) {
  /** @type {Behaviour[]} */
  const found = []
  for (const child of Array.from(element.children)) {
    const tag = child.tagName.toLowerCase()
    if (tag === "canon-fixture") continue
    if (tag !== "canon-behaviour" || !child.getAttribute("id")) continue
    const at = address(path, child.getAttribute("id"))
    found.push({
      address: at,
      title: titleOf(child),
      detail: detailOf(child),
      dependsOn: edges(child, path),
      parent,
      check: childOf(child, "script")?.textContent?.trim() ?? "",
      fixture: childOf(child, "canon-fixture")?.innerHTML?.trim() ?? "",
    })
    found.push(...behavioursIn(child, path, at))
  }
  return found
}

/**
 * Every axiom and specification the corpus declares.
 *
 * This reads `data-conforms-to`, the same way everything here locates an
 * instance, which also skips the schema elements in the template's own
 * `<template>` blocks: those declare a shape and conform to nothing. It then
 * takes behaviours by tag name inside a conforming specification, since a
 * behaviour nested in its specification carries no separate conformance of its
 * own.
 *
 * @param {AuditFs} fs
 * @returns {Canon}
 */
export function readCanon(fs) {
  /** @type {CanonEntry[]} */
  const axioms = []
  /** @type {Specification[]} */
  const specifications = []

  for (const path of fs.list(fs.docsDir, { ext: ".html" })) {
    const doc = fs.parse(path)
    for (const element of Array.from(doc.querySelectorAll('canon-axiom[data-conforms-to]'))) {
      axioms.push({
        address: address(path, element.getAttribute("id")),
        title: titleOf(element),
        detail: detailOf(element),
        dependsOn: edges(element, path),
      })
    }
    for (const element of Array.from(doc.querySelectorAll('canon-specification[data-conforms-to]'))) {
      specifications.push({
        address: address(path, element.getAttribute("id")),
        title: titleOf(element),
        detail: detailOf(element),
        dependsOn: edges(element, path),
        specifies: edges(element, path, "specifies"),
        behaviours: behavioursIn(element, path, null),
      })
    }
  }

  return { axioms, specifications }
}

/**
 * One declaration in the code, and the behaviours its doc comment names.
 *
 * @typedef {object} CodeCitation
 * @property {string} address file#name, so the declaration has an address like every other rung.
 * @property {string} file
 * @property {string} name
 * @property {string} kind What the declaration is, as the compiler reports it: function, variable,
 *   type. Empty when a comment leads nothing the parser names.
 * @property {string} doc The comment's prose, with the tag lines already gone.
 * @property {string} snippet The declaration's own source, whole where the parser knows its span.
 * @property {string[]} cites Behaviour addresses, in the same docs-root form the rest of this file uses.
 */

const TAG = /@behaviour\s+(\S+)/g

// How many lines to keep when the parser can't say where a declaration ends.
const SNIPPET_LINES = 8

/**
 * The code a comment introduces.
 *
 * A doc comment sits on a declaration, and the parser hands back that
 * declaration's whole span, so a reader following a claim down to the code gets
 * the code rather than its first few lines. Nothing here counts lines or guesses
 * where a body closes.
 *
 * A line comment may lead anything, including a step inside a function that no
 * span describes. There the count stands in.
 *
 * @param {string} text
 * @param {{end: number, subject: {start: number | null, end: number | null}}} comment
 * @returns {string}
 */
function bodyOf(text, comment) {
  const { start, end } = comment.subject
  if (start !== null && end !== null) return text.slice(start, end)
  return text
    .slice(comment.end)
    .replace(/^\s*\n/, "")
    .split("\n")
    .slice(0, SNIPPET_LINES)
    .join("\n")
}

/**
 * Every behaviour citation the code carries, read out of its doc comments.
 *
 * Only files a specification names get read. That boundary comes from the
 * corpus rather than a list here, so a file nothing specifies is not
 * participating and its silence means nothing.
 *
 * An .html file carries its code inside script blocks, and a comment's position
 * gets offset by where its script starts, so a citation in a template reports
 * the same way one in a source file does.
 *
 * @param {AuditFs} fs
 * @param {string[]} specifies
 * @returns {CodeCitation[]}
 */
export function collectCodeCitations(fs, specifies) {
  /** @type {CodeCitation[]} */
  const found = []

  for (const file of [...new Set(specifies)]) {
    /** @type {string} */
    let source
    try {
      source = fs.read(file)
    } catch {
      continue
    }

    /** @type {{text: string, offset: number, label: string | null}[]} */
    const blocks = []
    if (file.endsWith(".html")) {
      const doc = fs.parse(file)
      let searchFrom = 0
      for (const script of /** @type {any[]} */ (Array.from(doc.querySelectorAll("script")))) {
        const text = script.textContent ?? ""
        const offset = source.indexOf(text, searchFrom)
        if (offset === -1) continue
        searchFrom = offset + text.length
        blocks.push({ text, offset, label: script.getAttribute("data-audits") ?? script.getAttribute("id") })
      }
    } else {
      blocks.push({ text: source, offset: 0, label: null })
    }

    for (const block of blocks) {
      for (const comment of commentRanges(block.text)) {
        const cites = [...comment.raw.matchAll(TAG)].map((m) => `${fs.docsDir}/${m[1]}`)
        if (!cites.length) continue
        const at = block.offset + comment.pos
        // An audit's own script tag already names it, so a nameless declaration takes that name.
        const name = comment.subject.name ?? block.label ??
          `at-line-${source.slice(0, at).split("\n").length}`
        found.push({
          address: `${file}#${name}`,
          file,
          name,
          kind: comment.subject.declares ?? "",
          doc: comment.text,
          snippet: bodyOf(block.text, comment),
          cites,
        })
      }
    }
  }

  return found
}
