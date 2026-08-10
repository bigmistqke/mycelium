// Both ends of the joint between a specification and a test: which behaviours
// the corpus states, and which behaviour each test says it checks.
//
// Both rungs are documents, so both readings are the same reading: find the
// elements, follow their edges. A test case cites the behaviour it checks with
// an ordinary `depends_on`, exactly as a specification cites the axiom it
// serves one rung up.
//
// Kept out of the audits that use it. Three of them need the same two
// readings, and a second copy is how two checks come to disagree about what a
// citation is.
import type { AuditFs } from "../../src/api.ts"
import { commentRanges } from "./code-comments.ts"



export interface CanonEntry {
  address: string
  title: string
  /**
   * The reasoning under the claim, as the markup it carries. A title states a
   * rule in one line and one line has no room for what it rules out, so a
   * reader wanting the why needs this beside the graph rather than behind a
   * link. Empty for a claim carrying none.
   */
  detail: string
  /**
   * Where this entry points, already resolved to addresses. Stored edges point
   * up only: a specification names the axioms it serves and an axiom names the
   * one it narrows, so anything asking what sits beneath either computes it
   * from these rather than reading an authored reverse index.
   */
  dependsOn: string[]
}

export interface Specification extends CanonEntry {
  behaviours: Behaviour[]
  /**
   * The files this subsystem answers for, already resolved. A specification
   * points at code rather than naming a subsystem, so this link set is the
   * whole of what the subsystem covers.
   */
  specifies: string[]
}

export interface Behaviour extends CanonEntry {
  /**
   * The behaviour this one narrows, when it sits inside another. A claim made
   * of narrower claims holds them, so the parent is where the markup puts it
   * rather than an edge somebody wrote.
   */
  parent: string | null
  /**
   * The check that falsifies this claim, as its own source. A leaf carries one;
   * a claim proved by the ones beneath it carries an empty string.
   *
   * The source rather than a flag saying one exists. A claim is a sentence
   * about the system and the check is the only thing that can argue with it, so
   * anything showing a reader the claim has something to show them beside it.
   */
  check: string
  /**
   * The markup a browser case runs against, empty for every other claim.
   *
   * Half of what a browser case says lives here: an assertion about a row index
   * means nothing without the boxes it counts rows over.
   */
  fixture: string
}

export interface Canon {
  axioms: CanonEntry[]
  specifications: Specification[]
}

/**
 * An address is a path from the repository root and an optional fragment,
 * written the one way, so a citation and a behaviour can be compared as
 * strings.
 *
 * Everything below builds one through here rather than by concatenating in
 * place.
 */
export function address(path: string, fragment?: string | null): string {
  return fragment ? `${path}#${fragment}` : path
}

/**
 * Resolves an href written inside `path` against the repository root, since a
 * document links relatively and an address does not.
 *
 * An href with no path is this same document, which is how a sample case points
 * at a sample behaviour beside it.
 */
export function resolveHref(path: string, href: string): string {
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

function edges(element: Element, path: string, rel = "depends_on"): string[] {
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
 */
function childOf(element: Element, tag: string): Element | undefined {
  return Array.from(element.children).find((child) => child.tagName.toLowerCase() === tag)
}

function titleOf(element: Element): string {
  return childOf(element, "canon-title")?.textContent?.trim() ?? ""
}

/**
 * A claim's own reasoning, as markup rather than text, since a detail holds
 * paragraphs.
 *
 * A parent showing a child's reasoning would put an argument under a heading it
 * never made, which is one of the reasons childOf looks no deeper.
 */
function detailOf(element: Element): string {
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
 */
function behavioursIn(element: Element, path: string, parent: string | null): Behaviour[] {
  const found: Behaviour[] = []
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
 */
export function readCanon(fs: AuditFs): Canon {
  const axioms: CanonEntry[] = []
  const specifications: Specification[] = []

  for (const path of fs.list("docs", { ext: ".html" })) {
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
 */
export interface CodeCitation {
  /** file#name, so the declaration has an address like every other rung. */
  address: string
  file: string
  name: string
  /**
   * What the declaration is, as the compiler reports it: function, variable,
   * type. Empty when a comment leads nothing the parser names.
   */
  kind: string
  /** The comment's prose, with the tag lines already gone. */
  doc: string
  /** The declaration's own source, whole where the parser knows its span. */
  snippet: string
  /** Behaviour addresses, in the same docs-root form the rest of this file uses. */
  cites: string[]
}

const TAG = /@behaviour\s+(\S+)/g

/**
 * How much of a declaration to keep when the parser cannot say where it ends.
 *
 * A run of line comments binds to whatever follows it, which may be a step
 * rather than a named thing, so there is no node to take and a few lines is the
 * honest guess.
 */
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
 */
function bodyOf(text: string, comment: { end: number; subject: { start: number | null; end: number | null } }): string {
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
 */
export function collectCodeCitations(fs: AuditFs, specifies: string[]): CodeCitation[] {
  const found: CodeCitation[] = []

  for (const file of [...new Set(specifies)]) {
    let source: string
    try {
      source = fs.read(file)
    } catch {
      continue
    }

    const blocks: { text: string; offset: number; label: string | null }[] = []
    if (file.endsWith(".html")) {
      const doc = fs.parse(file)
      let searchFrom = 0
      for (const script of Array.from(doc.querySelectorAll("script")) as any[]) {
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
        const cites = [...comment.raw.matchAll(TAG)].map((m) => `docs/${m[1]}`)
        if (!cites.length) continue
        const at = block.offset + comment.pos
        // An audit exports one default function and never names it, since the
        // tag above the script already says which audit it is. The script's own
        // name is that name, so a nameless declaration takes it rather than a
        // line number nobody can read.
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
