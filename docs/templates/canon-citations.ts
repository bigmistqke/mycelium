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

export interface Citation {
  // The behaviour this case claims to check, as an address.
  target: string
  // The case that made the claim, also as an address, since a case carries an
  // id and therefore needs no invented name.
  source: string
}

export interface TestSite {
  // `docs/tests/link-href.test.html#language-link-crosses-directories`.
  address: string
  name: string
  citations: Citation[]
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
  // The files this subsystem answers for, already resolved. A specification
  // points at code rather than naming a subsystem, so this link set is the
  // whole of what the subsystem covers.
  specifies: string[]
}

export interface Canon {
  axioms: CanonEntry[]
  specifications: Specification[]
}

// An address is a path from the repository root and an optional fragment,
// written the one way, so a citation and a behaviour can be compared as
// strings. Everything below builds one through here rather than by
// concatenating in place.
export function address(path: string, fragment?: string | null): string {
  return fragment ? `${path}#${fragment}` : path
}

// Resolves an href written inside `path` against the repository root, since a
// document links relatively and an address does not. An href with no path is
// this same document, which is how a sample case points at a sample behaviour
// beside it.
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

// Every test case in the corpus, with whatever behaviour each one cites.
//
// Found through `data-conforms-to`, the same way readCanon finds an axiom, so
// the declaration inside test.template.html's own `<template>` is not mistaken
// for a case somebody wrote.
//
// A case with no edge comes back carrying no citations rather than not coming
// back at all. That is the whole point. A case citing nothing is what `cited`
// exists to catch, and a reader enumerating citations could never see one.
export function collectTests(fs: AuditFs): TestSite[] {
  const sites: TestSite[] = []
  for (const path of fs.list("docs", { ext: ".html" })) {
    for (const element of Array.from(fs.parse(path).querySelectorAll("test-case[data-conforms-to][id]"))) {
      const at = address(path, element.getAttribute("id"))
      sites.push({
        address: at,
        name: Array.from(element.children)
          .find((child) => child.tagName.toLowerCase() === "test-name")
          ?.textContent?.trim() ?? "",
        citations: edges(element, path).map((target) => ({ target, source: at })),
      })
    }
  }
  return sites
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
        specifies: edges(element, path, "specifies"),
        behaviours: Array.from(element.querySelectorAll("canon-behaviour[id]")).map((behaviour) => ({
          address: address(path, behaviour.getAttribute("id")),
          title: titleOf(behaviour),
          dependsOn: edges(behaviour, path),
        })),
      })
    }
  }

  return { axioms, specifications }
}
