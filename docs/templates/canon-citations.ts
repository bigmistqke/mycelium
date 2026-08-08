// Both ends of the joint between a specification and a test: which behaviours
// the corpus states, and which behaviour each test says it checks.
//
// A test gets no document. It joins the chain through a comment carrying
// `@specification`, then a path from the repository root, then a fragment.
// Nothing else records that link, so a check asking whether a behaviour has a
// test has to read source as well as documents. That is why an audit's
// filesystem sits one level above docs/ rather than inside it.
//
// Kept out of the audits that use it. Three of them need the same two
// readings, and a second copy is how two checks come to disagree about what a
// citation is.
import { testRanges } from "./code-comments.ts"
import type { AuditFs } from "../../src/api.ts"

// The tag is the long word. `spec add` here writes a design document, so
// `@spec` would name one family and point at another.
//
// A tag with no target after it matches nothing and reads as no citation at
// all, which leaves the test carrying it citing nothing. That is what `cited`
// reports anyway, so the mistake surfaces without a second kind of violation
// for it.
const CITATION = /@specification\s+(\S+)/g

// An address is a path from the repository root and an optional fragment,
// written the one way, so a citation and a behaviour can be compared as
// strings. Everything below builds one through here rather than by
// concatenating in place.
export function address(path: string, fragment?: string | null): string {
  return fragment ? `${path}#${fragment}` : path
}

// Resolves an href written inside `path` against the repository root, since a
// document links relatively and a citation does not. An href with no path is
// this same document, which is how a sample specification points at a sample
// axiom beside it.
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

export interface Citation {
  // The behaviour this test claims to check, as an address.
  target: string
  // The file holding the citation and the test it sits above, so a violation
  // can name a place someone can open.
  source: string
  test: string
}

export interface TestSite {
  source: string
  name: string
  citations: Citation[]
}

// How a violation names a test, since a test has no id to name it by. A line
// number would be the obvious address and is the wrong one: an audit declares
// its expected violations in data-expects, and a declaration that moves
// whenever somebody edits the line above it stops demonstrating anything.
export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

// Every leaf test in one source, with whatever its own leading comment cites.
//
// This walks tests rather than comments, so a test with a bare line above it
// comes back carrying no citations instead of not coming back at all. Reading
// the comment bound to the node keeps a citation attached to the test below
// it, which is the whole claim a citation makes.
//
// A citation above anything else does not count. Only a leaf test carries one,
// and a tag sitting above a helper is a citation nothing stands behind: the
// behaviour it names still has no test, and `exhaustive` says so from the
// other side.
export function testSites(source: string, label: string): TestSite[] {
  return testRanges(source).map((test) => {
    const name = test.name ?? "(unnamed)"
    return {
      source: label,
      name,
      citations: Array.from(test.comment?.text.matchAll(CITATION) ?? [], (match) => ({
        target: match[1],
        source: label,
        test: name,
      })),
    }
  })
}

// Two places hold code, not one. Eight documents in this corpus keep a command
// or an audit in a script block, so a test written the same way is reachable
// only by reading script blocks as well as files.
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"]

export function collectTests(fs: AuditFs): TestSite[] {
  const sites: TestSite[] = []
  for (const extension of SOURCE_EXTENSIONS) {
    for (const path of fs.list(".", { ext: extension })) {
      sites.push(...testSites(fs.read(path), path))
    }
  }
  for (const path of fs.list("docs", { ext: ".html" })) {
    for (const script of Array.from(fs.parse(path).querySelectorAll("script"))) {
      sites.push(...testSites(script.textContent ?? "", path))
    }
  }
  return sites
}

export interface CanonEntry {
  address: string
  title: string
  // Where this entry points, already resolved to addresses. Stored edges point
  // up only: a specification names the axioms it serves and an axiom names the
  // one it narrows, so anything asking what sits beneath either computes it
  // from these rather than reading an authored reverse index.
  dependsOn: string[]
}

export interface Specification extends CanonEntry {
  behaviours: CanonEntry[]
}

export interface Canon {
  axioms: CanonEntry[]
  specifications: Specification[]
}

function edges(element: Element, path: string): string[] {
  return Array.from(element.children)
    .filter((child) => child.tagName.toLowerCase() === "a" && child.getAttribute("data-rel") === "depends_on")
    .map((child) => resolveHref(path, child.getAttribute("href") ?? ""))
}

function titleOf(element: Element): string {
  return Array.from(element.children)
    .find((child) => child.tagName.toLowerCase() === "canon-title")
    ?.textContent?.trim() ?? ""
}

// Every axiom and specification the corpus declares.
//
// This reads `data-conforms-to`, the same way everything here locates an
// instance, which also skips the schema elements in the template's own
// `<template>` blocks: those declare a shape and conform to nothing. It then
// takes behaviours by tag name inside a conforming specification, since a
// behaviour nested in its specification carries no separate conformance of its
// own.
export function readCanon(fs: AuditFs): Canon {
  const axioms: CanonEntry[] = []
  const specifications: Specification[] = []

  for (const path of fs.list("docs", { ext: ".html" })) {
    const doc = fs.parse(path)
    for (const element of Array.from(doc.querySelectorAll('canon-axiom[data-conforms-to]'))) {
      axioms.push({
        address: address(path, element.getAttribute("id")),
        title: titleOf(element),
        dependsOn: edges(element, path),
      })
    }
    for (const element of Array.from(doc.querySelectorAll('canon-specification[data-conforms-to]'))) {
      specifications.push({
        address: address(path, element.getAttribute("id")),
        title: titleOf(element),
        dependsOn: edges(element, path),
        behaviours: Array.from(element.querySelectorAll("canon-behaviour[id]")).map((behaviour) => ({
          address: address(path, behaviour.getAttribute("id")),
          title: titleOf(behaviour),
          dependsOn: [],
        })),
      })
    }
  }

  return { axioms, specifications }
}
