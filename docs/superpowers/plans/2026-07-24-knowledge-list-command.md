# Knowledge CLI `list` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `mycelium knowledge list nodes`/`list edges` — an enumeration of the real knowledge graph, closing the CLAUDE.md-named gap that `pnpm crawl` only reports pass/fail, never a clean list. Getting there safely requires two prerequisite fixes: deduplicating `parseHTML`/`walkHtmlFiles` (currently copy-pasted in both `crawl.ts` and `run.ts`) into a shared module, and making `Filesystem.commit()` skip writing files that were read but never actually mutated — without that fix, a read-only `list` command would rewrite the entire graph to disk on every invocation.

**Architecture:** (1) `src/fs-helpers.ts` — new shared module for `parseHTML`/`walkHtmlFiles`, imported by both `crawl.ts` and `run.ts`. (2) `run.ts`'s `Filesystem` class: `get()`/`create()` snapshot each document's serialized HTML at read time; `commit()` compares against that snapshot and skips the write if unchanged; a new `list(dir)` method walks a directory and returns every parsed document. (3) `knowledge.template.html`'s existing `type="mycelium/command"` script gains a fourth export, `list`, using `fs.list('knowledge')`.

**Tech Stack:** Node ≥24 native TS stripping (same as the rest of `src/`), happy-dom. No new dependencies. No test framework — verification is `pnpm crawl` plus direct CLI invocation with inspected output, same as every prior task in this project.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-24-mycelium-list-command.spec.html` — read it before starting.
- Relative imports between local `.ts` files must use the explicit `.ts` extension (e.g. `import { parseHTML } from "./fs-helpers.ts"`) — Node's native type-stripping resolves imports by their literal written path, unlike a bundler's extension-optional resolution.
- `crawl.ts` and `run.ts` must keep working exactly as before for everything that isn't `list` — this is a refactor-then-extend, not a rewrite. `pnpm crawl`'s validator/audit output must be byte-for-byte the same shape after Task 1 as before it.
- `list` is scoped to `docs/knowledge/*.html` only (via `fs.list('knowledge')`) — not template sample instances, not `spec-doc` files. This one directory assumption is deliberately knowledge-specific and lives in the `list` command itself, not in `Filesystem.list(dir)`, which takes an arbitrary directory and knows nothing about what's in it.
- `list nodes` reads a node's type directly off its root element's own tag name (`el.tagName.toLowerCase()`) — do not hardcode a list of the six known types (unlike the two audits' `TYPES` array); a future seventh type should show up in `list` with no code change.
- Run all `pnpm` commands from `experiments/v4/` (or prefix with `pnpm --filter @mycelium/v4` from the repo root).
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` to log actions as you go, the same way prior work in this repo did. `update` now exists — use it, not a hand-edit, to close out any action node this plan creates.

---

### Task 1: Extract shared `src/fs-helpers.ts`

**Files:**
- Create: `experiments/v4/src/fs-helpers.ts`
- Modify: `experiments/v4/src/crawl.ts:1-16, 41-50` (remove local `parseHTML`/`walkHtmlFiles`, import from the new module)
- Modify: `experiments/v4/src/run.ts:1-30` (remove local `parseHTML`/`walkHtmlFiles`, import from the new module)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `parseHTML(html: string): { document: Document }` and `walkHtmlFiles(dir: string): string[]`, both exported from `experiments/v4/src/fs-helpers.ts`, imported by name into both `crawl.ts` and `run.ts`. Task 2 imports `walkHtmlFiles` from this same module for `Filesystem.list()`.

- [ ] **Step 1: Create the shared module**

Create `experiments/v4/src/fs-helpers.ts`:

```ts
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { Window } from "happy-dom"

export function parseHTML(html: string): { document: Document } {
  const window = new Window()
  window.document.write(html)
  return { document: window.document as unknown as Document }
}

export function walkHtmlFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) results.push(...walkHtmlFiles(full))
    else if (entry.endsWith(".html")) results.push(full)
  }
  return results
}
```

This is a verbatim move of the two functions as they exist identically in both `crawl.ts` and `run.ts` today — no behavior change, just `export` added and relocated.

- [ ] **Step 2: Update `crawl.ts` to import from the shared module**

In `experiments/v4/src/crawl.ts`, replace the top of the file (lines 1-16):

```ts
// The mycelium v4 crawler. Protocol-only: it knows about <template>,
// data-conforms-to, data-validates, and data-audits — nothing about what
// any project builds on top of them. See docs/specs/2026-07-23-mycelium-crawler.spec.html.

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, dirname, resolve as resolvePath } from "node:path"
import { Window } from "happy-dom"
import "./runtime.js"

const { loadCheck } = globalThis.mycelium

function parseHTML(html: string): { document: Document } {
  const window = new Window()
  window.document.write(html)
  return { document: window.document as unknown as Document }
}
```

with:

```ts
// The mycelium v4 crawler. Protocol-only: it knows about <template>,
// data-conforms-to, data-validates, and data-audits — nothing about what
// any project builds on top of them. See docs/specs/2026-07-23-mycelium-crawler.spec.html.

import { readFileSync } from "node:fs"
import { dirname, resolve as resolvePath } from "node:path"
import { parseHTML, walkHtmlFiles } from "./fs-helpers.ts"
import "./runtime.js"

const { loadCheck } = globalThis.mycelium
```

Then remove the now-duplicate `walkHtmlFiles` function definition later in the same file (currently lines 41-50):

```ts
function walkHtmlFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) results.push(...walkHtmlFiles(full))
    else if (entry.endsWith(".html")) results.push(full)
  }
  return results
}

```

Delete that whole block (including the blank line after it) — `walkHtmlFiles` is now imported instead.

- [ ] **Step 3: Update `run.ts` to import from the shared module**

In `experiments/v4/src/run.ts`, replace the top of the file (lines 1-30):

```ts
// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// crawl.ts: the engine knows <template>, data-conforms-to, and how to find
// the one script[type="mycelium/command"] a template file declares — never
// what any command actually does. See
// docs/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { Window } from "happy-dom"
import { parse } from "acorn"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

function parseHTML(html: string): { document: Document } {
  const window = new Window()
  window.document.write(html)
  return { document: window.document as unknown as Document }
}

function walkHtmlFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) results.push(...walkHtmlFiles(full))
    else if (entry.endsWith(".html")) results.push(full)
  }
  return results
}
```

with:

```ts
// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// crawl.ts: the engine knows <template>, data-conforms-to, and how to find
// the one script[type="mycelium/command"] a template file declares — never
// what any command actually does. See
// docs/specs/2026-07-23-mycelium-authoring-commands.spec.html.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { parse } from "acorn"
import { parseHTML, walkHtmlFiles } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium
```

(`join` stays imported — `findTemplateFile`, unchanged, still uses it below.)

- [ ] **Step 4: Verify no regression**

```bash
cd experiments/v4
pnpm crawl
```

Expected: identical shape to before this change — `validators: 45 pass, 0 fail`, same two known sample-fixture audit failures. (If the exact pass count has drifted since this plan was written because other work landed in between, that's fine — what matters is `0 fail` and no new audit violations beyond the two known ones.)

```bash
pnpm mycelium knowledge --help
```

Expected: still lists `add`, `link`, `update` with their doc comments — proves `run.ts` still parses and dispatches correctly after the import changes.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/src/fs-helpers.ts experiments/v4/src/crawl.ts experiments/v4/src/run.ts
git commit -m "experiment(v4): extract parseHTML/walkHtmlFiles into a shared fs-helpers module

Both were duplicated verbatim between crawl.ts and run.ts. A third
copy was about to appear for the list command's directory-walking
need — move them into src/fs-helpers.ts once instead, imported by
both files. No behavior change."
```

---

### Task 2: `Filesystem` safety fix + `list(dir)`

**Files:**
- Modify: `experiments/v4/src/run.ts` (the `Filesystem` class — depends on Task 1's import of `walkHtmlFiles`)

**Interfaces:**
- Consumes: `walkHtmlFiles(dir: string): string[]` and `parseHTML(html: string): { document: Document }`, both from Task 1's `./fs-helpers.ts` import (already in scope after Task 1 — no new import needed in this task).
- Produces: `Filesystem.list(dir: string): { path: string; doc: Document }[]`. Task 3's `list` command calls `fs.list('knowledge')` and expects exactly this shape — `path` relative to the `docs/` root (e.g. `"knowledge/some-node.action.html"`, matching the same relative-path convention `commit()`'s own log lines already use), `doc` a mutable `Document` (though `list`, the command, never mutates it).

- [ ] **Step 1: Replace the `Filesystem` class**

In `experiments/v4/src/run.ts`, replace the entire `Filesystem` class (currently the block starting at the comment `// The write side of the fs.get/fs.create/fs.delete contract...` through the closing `}` of `commit()`):

```ts
// The write side of the fs.get/fs.create/fs.delete contract: a command
// mutates the Document objects handed to it, in place, and never returns
// anything. Everything touched gets serialized and written (or removed,
// for deletes) once the command function has finished running — the same
// three operations regardless of what the command did internally.
//
// get()/create() snapshot each document's serialized HTML the moment it's
// parsed; commit() re-serializes and compares against that snapshot before
// writing, skipping any file that was read but never actually mutated.
// Both snapshots go through the same happy-dom serialization path, so
// parse/reserialize formatting noise cancels out on both sides — the only
// way they can differ is a real change in between. This is what makes
// list() (below) safe to call on dozens of files just to read them.
class Filesystem {
  #root: string
  #touched = new Map<string, { doc: Document; original: string } | { deleted: true }>()

  constructor(root: string) {
    this.#root = root
  }

  get(path: string): Document {
    const full = resolvePath(this.#root, path)
    let entry = this.#touched.get(full)
    if (!entry) {
      const html = readFileSync(full, "utf8")
      const { document } = parseHTML(html)
      const doc = document as unknown as Document
      entry = { doc, original: doc.documentElement!.outerHTML }
      this.#touched.set(full, entry)
    }
    if (!("doc" in entry)) throw new Error(`${path} was already deleted`)
    return entry.doc
  }

  create(path: string, seedHtml: string): Document {
    const full = resolvePath(this.#root, path)
    const { document } = parseHTML(seedHtml)
    // No "original" snapshot matches a real document's serialization, so a
    // created file is always written — same as today's behavior.
    this.#touched.set(full, { doc: document as unknown as Document, original: "" })
    return document as unknown as Document
  }

  delete(path: string): void {
    const full = resolvePath(this.#root, path)
    this.#touched.set(full, { deleted: true })
  }

  // Reads every .html file under dir (relative to this Filesystem's root)
  // via get(), so every file it returns is tracked the same way a single
  // get() call would be — no separate read-only path, no separate tracking.
  list(dir: string): { path: string; doc: Document }[] {
    const full = resolvePath(this.#root, dir)
    return walkHtmlFiles(full).map((file) => {
      const path = relativePath(this.#root, file)
      return { path, doc: this.get(path) }
    })
  }

  commit(): string[] {
    const written: string[] = []
    for (const [full, entry] of this.#touched) {
      const label = relativePath(this.#root, full)
      if ("deleted" in entry) {
        unlinkSync(full)
        console.log(`deleted  ${label}`)
        continue
      }
      const html = entry.doc.documentElement!.outerHTML
      if (html === entry.original) continue
      writeFileSync(full, "<!DOCTYPE html>\n" + html + "\n")
      console.log(`wrote    ${label}`)
      written.push(full)
    }
    return written
  }
}
```

- [ ] **Step 2: Verify existing commands still write when they should, in an isolated scratch copy**

```bash
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cd "$SCRATCH"

# create: must still write (new file, no prior snapshot to match)
node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge add action --title "safety fix test" --confidence 60 --file safety-fix-test
test -f docs/knowledge/safety-fix-test.action.html && echo "PASS: created"

# update with a real change: must still write
node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge update safety-fix-test.action.html --status completed 2>&1 | grep "wrote.*safety-fix-test"
```

Expected: both commands print a `wrote    knowledge/safety-fix-test.action.html` line — real mutations are still written.

- [ ] **Step 3: Verify a no-op `update` no longer causes a spurious rewrite, same scratch copy**

```bash
node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge update safety-fix-test.action.html 2>&1
```

(No flags at all — every `field()` call inside `update` sees `undefined` and returns immediately, so nothing is mutated; the file is only ever read via `fs.get()`.)

Expected: **no** `wrote` line printed for `safety-fix-test.action.html` at all — before this task's fix, `commit()` would have unconditionally rewritten it anyway. This is the concrete proof the safety fix works.

```bash
cd /Users/bigmistqke/Documents/GitHub/mycelium
rm -rf "$SCRATCH"
```

- [ ] **Step 4: Verify no regression on the real graph**

```bash
cd experiments/v4
pnpm crawl
```

Expected: `validators: 45 pass, 0 fail` (or higher if more nodes were added since this plan was written), same two known audit failures, nothing new.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/src/run.ts
git commit -m "experiment(v4): make Filesystem.commit() skip unchanged files, add list(dir)

get()/create() now snapshot each document's serialized HTML at read
time; commit() compares against that snapshot and only writes what
actually changed. Without this, list(dir) — a directory-wide read via
the same get() every command already uses — would have caused every
file it read to be rewritten to disk on every invocation, since
commit() previously wrote everything it had ever touched
unconditionally."
```

---

### Task 3: `list` command

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html:596-` (the `type="mycelium/command"` script — add a fourth export after `update`)

**Interfaces:**
- Consumes: `fs.list('knowledge')` from Task 2, returning `{ path: string; doc: Document }[]`.
- Produces: the CLI surface `mycelium knowledge list nodes` / `mycelium knowledge list edges`, discoverable via `mycelium knowledge --help` (automatic, same JSDoc-extraction mechanism as `add`/`link`/`update`).

- [ ] **Step 1: Add the `list` export**

In `experiments/v4/docs/templates/knowledge.template.html`, immediately after the closing `}` of `export function update(fs, args) { … }` (the last export before `</script>`), insert:

```js

  /**
   * List every node or edge in the real knowledge graph (docs/knowledge/).
   *
   *   mycelium run knowledge list nodes
   *   mycelium run knowledge list edges
   *
   * nodes: one line per file — path, type (read off the root element's
   * own tag name), status (blank if the type has none), title.
   * edges: one line per <a data-rel> found — source file, rel, href,
   * label text.
   */
  export function list(fs, args) {
    const kind = args._[0]
    const documents = fs.list('knowledge')

    if (kind === 'nodes') {
      for (const { path, doc } of documents) {
        const el = doc.querySelector('[data-conforms-to]')
        if (!el) continue
        const type = el.tagName.toLowerCase()
        const family = type.split('-')[0]
        const title = el.querySelector(`${family}-title`)?.textContent.trim() ?? ''
        const status = el.querySelector(`${family}-status`)?.textContent.trim() ?? ''
        console.log(`${path}\t${type}\t${status}\t${title}`)
      }
      return
    }

    if (kind === 'edges') {
      for (const { path, doc } of documents) {
        const el = doc.querySelector('[data-conforms-to]')
        if (!el) continue
        for (const a of el.querySelectorAll('a[data-rel]')) {
          const rel = a.getAttribute('data-rel')
          const href = a.getAttribute('href')
          console.log(`${path}  --${rel}-->  ${href}  ${a.textContent.trim()}`)
        }
      }
      return
    }

    console.error(`unknown list kind "${kind}" — expected "nodes" or "edges"`)
  }
```

- [ ] **Step 2: Verify `--help` picks it up automatically**

```bash
cd experiments/v4
pnpm mycelium knowledge --help
```

Expected: output now lists four commands — `add`, `link`, `update`, `list` — with `list`'s doc comment printed verbatim.

- [ ] **Step 3: Verify `list nodes` against the real graph**

`list` never mutates anything (it only calls `fs.list()`, which only calls `get()`, never `create()`/`delete()`), and Task 2's safety fix means `commit()` won't rewrite anything it read — so this is safe to run directly against the real repo, no scratch copy needed.

```bash
pnpm mycelium knowledge list nodes | grep "finalize-knowledge-cli"
pnpm mycelium knowledge list nodes | grep "implement-listing-command"
git status --short experiments/v4/docs/knowledge/
```

Expected: both `grep`s find their respective lines, each showing the file path, its type (`knowledge-goal` for both), status (`completed` for both, if you're running this after those nodes were finalized — `active` if run before), and title. The `git status --short` must print **nothing** — proof that reading the entire real `knowledge/` directory caused zero writes.

- [ ] **Step 4: Verify `list edges` against the real graph**

```bash
pnpm mycelium knowledge list edges | grep "finalize-knowledge-cli"
git status --short experiments/v4/docs/knowledge/
```

Expected: a line showing `finalize-knowledge-cli.goal.html  --leads_to-->  ../specs/2026-07-24-mycelium-list-command.spec.html  <label text>` (or `.../2026-07-23-mycelium-update-command.spec.html`, whichever edge exists at the time this runs — that node has picked up more than one `leads_to` edge over the course of this project). `git status --short` again prints nothing.

- [ ] **Step 5: Verify the unknown-kind error path**

```bash
pnpm mycelium knowledge list 2>&1
pnpm mycelium knowledge list bogus 2>&1
```

Expected: both print `unknown list kind "undefined" — expected "nodes" or "edges"` and `unknown list kind "bogus" — expected "nodes" or "edges"` respectively (to stderr), and exit without printing any node/edge lines.

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): add mycelium knowledge list, close the enumeration gap

pnpm crawl reports pass/fail per instance but never a clean
enumeration, the gap CLAUDE.md names versus deciduous nodes/deciduous
edges. list nodes/list edges read the real graph via fs.list
(knowledge/), safe to run against the live repo now that commit()
skips unchanged files. Type is read off each node's own root tag
rather than a hardcoded list of the six known types."
```

Then use `pnpm mycelium knowledge update` (not a hand-edit) to close out whatever action node this task's own logging created, per this repo's workflow.

---

## Self-Review Notes

- **Spec coverage:** shared `fs-helpers.ts` module → Task 1. `Filesystem` snapshot-diffing + `list(dir)` → Task 2. `list` command, scoped to `knowledge/`, type read off the root tag, `nodes`/`edges` output shapes → Task 3. `spec-out-of-scope` items (no filename convention change, no `--branch` filter, no spec-doc listing, no `data-lists` mechanism) → none appear as tasks, correctly.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable.
- **Type consistency:** `Filesystem.list(dir)`'s return shape (`{ path, doc }[]`) matches exactly what Task 3's `list` command destructures (`for (const { path, doc } of documents)`). `el.tagName.toLowerCase()` for type-derivation in Task 3 matches the same pattern Task 1 of the *previous* plan (closed-schema validators) already established for the same purpose.
