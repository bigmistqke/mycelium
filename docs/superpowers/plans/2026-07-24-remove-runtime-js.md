# Remove runtime.js Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete `src/runtime.js`/`src/runtime.d.ts` outright. Move `loadModule`/`loadCheck` into `src/utils.ts` (renamed from `fs-helpers.ts`) as real, typed exports for the two Node consumers (`run.ts`, `validate.ts`); duplicate the same five lines directly inline in the one browser-facing live demo that needs it (`knowledge.template.html`'s graph-wide-audits section), instead of sharing them through a file either side has to load specially.

**Architecture:** Three sequential tasks, each leaving the repo working. Task 1 moves the Node side over first — `runtime.js` stays on disk, untouched, still serving the browser's `<script src>` tag. Task 2 replaces that last browser consumer with an inline copy and only then deletes `runtime.js`/`runtime.d.ts`. Task 3 updates the two living docs that explain the old shared-file mechanism, and logs a new `knowledge-decision` node (not an edit to the existing `reverse-runtime-to-globalthis.decision.html`, which stays correct about the narrower question it actually answered).

**Tech Stack:** Node ≥24, TypeScript via native type stripping, happy-dom (already a dependency). No new dependencies. No test framework — verification is running the tool directly and, for the one browser-only change in Task 2, actually opening the page.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-24-mycelium-remove-runtime-js.spec.html` — read it before starting.
- No new dependencies.
- `loadModule`/`loadCheck`'s exported type signatures in `utils.ts` must match exactly what `runtime.d.ts` currently declares: `loadModule(scriptSource: string): Promise<Record<string, unknown>>`, `loadCheck(scriptSource: string): Promise<(...args: unknown[]) => unknown>`.
- Every frozen spec (`docs/specs/*.html`) and every `docs/knowledge/*.html` node that mentions `runtime.js` stays exactly as-is — historical record, same convention this project has followed for every prior rename. Only living docs (`README.md`, `knowledge.template.html`'s live-demo prose) get updated.
- Do not edit `reverse-runtime-to-globalthis.decision.html`. It correctly recorded a different, narrower question (how to avoid `file://` CORS when something needs sharing) than this work answers (whether a five-line function with two call sites needs sharing machinery at all). Log a new `knowledge-decision` node instead, linked to the old one with `elaborates`, not `contradicts`.
- Task order matters and is not parallelizable: Task 1 leaves `runtime.js` on disk so the browser's `<script src>` tag keeps working while the Node side migrates; Task 2 must land before `runtime.js`/`runtime.d.ts` can be deleted.
- Run all `pnpm`/`node` commands from `experiments/v4/`.
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go.

---

### Task 1: Move loadModule/loadCheck into utils.ts, update the two Node consumers

**Files:**
- Rename: `experiments/v4/src/fs-helpers.ts` → `experiments/v4/src/utils.ts`
- Modify: `experiments/v4/src/run.ts`
- Modify: `experiments/v4/src/validate.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `utils.ts` exports `loadModule(scriptSource: string): Promise<Record<string, unknown>>` and `loadCheck(scriptSource: string): Promise<(...args: unknown[]) => unknown>`, alongside its existing `parseHTML`/`walkHtmlFiles`/`resolveTemplateRef`/`validateInstance`/`readStdin`. `run.ts`/`validate.ts` no longer reference `globalThis.mycelium` or `runtime.js` at all. `runtime.js`/`runtime.d.ts` are untouched by this task — the browser's `<script src="../../src/runtime.js">` tag (not modified until Task 2) still works throughout.

- [ ] **Step 1: Rename the file**

```bash
cd experiments/v4
git mv src/fs-helpers.ts src/utils.ts
```

- [ ] **Step 2: Replace `utils.ts` in full**

`experiments/v4/src/utils.ts` currently reads:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { Window } from "happy-dom"
import "./runtime.js"

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

// Given an instance's own file and its data-conforms-to value (a path
// relative to that file, plus a #fragment naming the type), resolves to
// "<absolute template file path>#<fragment>" — the same key both the
// validator lookup below and validate.ts's whole-corpus discovery use to
// find a type's <template>/<script data-validates> pair.
export function resolveTemplateRef(instanceFile: string, conformsTo: string): string {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

// Validates one element against its own declared type, for callers (like
// run.ts's authoring commands) that only ever need to check a single node
// they just built or mutated — not validate.ts's whole-corpus batch pass.
// Reads the referenced template file fresh on every call and never throws:
// an unresolvable reference is a reported failure, not an exception, the
// same way validate.ts already treats it.
export async function validateInstance(
  docsDir: string,
  instancePath: string,
  element: Element,
): Promise<{ ok: boolean; errors: string[] }> {
  const conformsTo = element.getAttribute("data-conforms-to")
  if (!conformsTo) return { ok: false, errors: ["missing data-conforms-to attribute"] }

  const instanceFile = resolvePath(docsDir, instancePath)
  const key = resolveTemplateRef(instanceFile, conformsTo)
  const [templateFile, fragId] = key.split("#")

  try {
    const { document } = parseHTML(readFileSync(templateFile, "utf8"))
    const scriptSource = (document as unknown as Document)
      .querySelector(`script[data-validates="#${fragId}"]`)
      ?.textContent

    if (!scriptSource) return { ok: false, errors: [`no template found at ${key}`] }

    const check = await globalThis.mycelium.loadCheck(scriptSource)
    const result = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    return { ok: result.ok, errors: (result.errors ?? result.violations ?? []) as string[] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${(err as Error).message}`] }
  }
}

// Drains stdin fully and returns it as a string. The only new shared
// primitive this project needs for rich-content authoring — what a
// command's own `-` sentinel means (if anything) is domain knowledge
// that stays in the command, not here.
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}
```

Replace the entire file with:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
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

// Given an instance's own file and its data-conforms-to value (a path
// relative to that file, plus a #fragment naming the type), resolves to
// "<absolute template file path>#<fragment>" — the same key both the
// validator lookup below and validate.ts's whole-corpus discovery use to
// find a type's <template>/<script data-validates> pair.
export function resolveTemplateRef(instanceFile: string, conformsTo: string): string {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

// A data: URL dynamic import — the one trick that lets a script's source
// text (pulled straight from a <script> tag, not a real file) run as a
// real ES module with no server and no real cross-file import, which
// would otherwise be CORS-checked with no stable origin to satisfy it
// over file://. Used identically for a type's validator, a graph-wide
// audit, and a template's own authoring commands. The one browser call
// site (knowledge.template.html's audits live-demo) duplicates these same
// five lines directly rather than importing this file — see
// docs/specs/2026-07-24-mycelium-remove-runtime-js.spec.html.
export async function loadModule(scriptSource: string): Promise<Record<string, unknown>> {
  return await import(`data:text/javascript,${encodeURIComponent(scriptSource)}`)
}

export async function loadCheck(scriptSource: string): Promise<(...args: unknown[]) => unknown> {
  const mod = await loadModule(scriptSource)
  return mod.check as (...args: unknown[]) => unknown
}

// Validates one element against its own declared type, for callers (like
// run.ts's authoring commands) that only ever need to check a single node
// they just built or mutated — not validate.ts's whole-corpus batch pass.
// Reads the referenced template file fresh on every call and never throws:
// an unresolvable reference is a reported failure, not an exception, the
// same way validate.ts already treats it.
export async function validateInstance(
  docsDir: string,
  instancePath: string,
  element: Element,
): Promise<{ ok: boolean; errors: string[] }> {
  const conformsTo = element.getAttribute("data-conforms-to")
  if (!conformsTo) return { ok: false, errors: ["missing data-conforms-to attribute"] }

  const instanceFile = resolvePath(docsDir, instancePath)
  const key = resolveTemplateRef(instanceFile, conformsTo)
  const [templateFile, fragId] = key.split("#")

  try {
    const { document } = parseHTML(readFileSync(templateFile, "utf8"))
    const scriptSource = (document as unknown as Document)
      .querySelector(`script[data-validates="#${fragId}"]`)
      ?.textContent

    if (!scriptSource) return { ok: false, errors: [`no template found at ${key}`] }

    const check = await loadCheck(scriptSource)
    const result = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    return { ok: result.ok, errors: (result.errors ?? result.violations ?? []) as string[] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${(err as Error).message}`] }
  }
}

// Drains stdin fully and returns it as a string. The only new shared
// primitive this project needs for rich-content authoring — what a
// command's own `-` sentinel means (if anything) is domain knowledge
// that stays in the command, not here.
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}
```

- [ ] **Step 3: Update `run.ts`'s import, drop the `runtime.js` side-effect import and `globalThis` destructure**

In `experiments/v4/src/run.ts`, find:

```ts
import { parseHTML, walkHtmlFiles, validateInstance, readStdin } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>
```

Replace with:

```ts
import { parseHTML, walkHtmlFiles, validateInstance, readStdin, loadModule } from "./utils.ts"

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>
```

- [ ] **Step 4: Update `validate.ts`'s import, drop the `runtime.js` side-effect import and `globalThis` destructure**

In `experiments/v4/src/validate.ts`, find:

```ts
import { parseHTML, walkHtmlFiles, resolveTemplateRef } from "./fs-helpers.ts"
import "./runtime.js"

const { loadCheck } = globalThis.mycelium
```

Replace with:

```ts
import { parseHTML, walkHtmlFiles, resolveTemplateRef, loadCheck } from "./utils.ts"
```

- [ ] **Step 5: Verify `utils.ts` loads and exports everything, including the two new functions**

```bash
cd experiments/v4
node -e "import('./src/utils.ts').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'parseHTML', 'walkHtmlFiles', 'resolveTemplateRef', 'loadModule', 'loadCheck', 'validateInstance', 'readStdin' ]` (order may vary).

- [ ] **Step 6: Verify `validate.ts` still behaves identically**

```bash
pnpm validate
```

Expected: same count as before this task, `0 fail` — this task is a pure refactor of how `loadCheck` is obtained, not a behavior change.

- [ ] **Step 7: Verify `run.ts`'s full command dispatch still works, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "utils.ts migration test" --confidence 60 --file utils-migration-test)
(cd "$SCRATCH" && node "$RUN" knowledge link utils-migration-test.observation.html build-v4.goal.html --rel supports --label "scratch test edge")
(cd "$SCRATCH" && node "$RUN" knowledge --help | head -3)
node "$VALIDATE" "$SCRATCH/docs"
rm -rf "$SCRATCH"
```

Expected: `wrote` for both `add` and `link`; `--help` prints the commands list (proves `loadModule` still loads the command script correctly); `0 fail` from the final validate — proves `run.ts`'s dispatch (`loadModule`) and `validate.ts`'s checking (`loadCheck`, exercised transitively via `add`/`update`'s `cli.validate`) both work end to end through the new `utils.ts` wiring.

- [ ] **Step 8: Verify the real repo is unaffected**

```bash
cd experiments/v4
pnpm validate
```

Expected: same count as before this task, `0 fail`.

- [ ] **Step 9: Commit**

```bash
git add experiments/v4/src/utils.ts experiments/v4/src/run.ts experiments/v4/src/validate.ts
git commit -m "experiment(v4): move loadModule/loadCheck into utils.ts, rename fs-helpers.ts

fs-helpers.ts renamed to utils.ts: once it holds loadModule/loadCheck
alongside parseHTML/walkHtmlFiles/resolveTemplateRef/validateInstance/
readStdin, \"filesystem helpers\" undersells what's in there — none of
the newly-added functions touch the filesystem. loadModule/loadCheck
move in as real, typed exports (matching runtime.d.ts's existing
signatures exactly), and run.ts/validate.ts pick them up through
their normal import instead of a globalThis.mycelium side-effect
import. runtime.js/runtime.d.ts are untouched by this commit — the
browser's <script src> tag still loads the old file until the next
task replaces that one remaining consumer."
```

---

### Task 2: Inline the browser copy, delete runtime.js/runtime.d.ts

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (the audits live-demo section only)
- Delete: `experiments/v4/src/runtime.js`
- Delete: `experiments/v4/src/runtime.d.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly (the browser-side change is independent of the Node-side rewiring) — but Task 1 must land first per the plan's stated ordering, since this task's deletion step assumes no Node file still imports `runtime.js`.
- Produces: nothing later tasks consume.

- [ ] **Step 1: Replace the audits live-demo's script loading and prose**

In `experiments/v4/docs/templates/knowledge.template.html`, find:

```
<div class="live-demo">
  <h4>This section actually runs</h4>
  <p>
    Runs the exact two <code>data-audits</code> scripts above, not a hand-copied re-implementation &mdash;
    their source text is pulled straight from the <code>&lt;script&gt;</code> tags and dynamically
    <code>import()</code>ed from a <code>data:</code> URL via <code>loadCheck</code>, loaded from the same
    <code>../../src/runtime.js</code> <a href="../specs/2026-07-23-mycelium-crawler.spec.html">the
    crawler</a> uses under Node &mdash; shared code, not a hand-copy, and still works with a plain
    double-click. That file has no <code>export</code> on purpose: a real ES module import would be
    CORS-checked, and <code>file://</code> has no stable origin to satisfy that check. Loaded here instead
    as a classic <code>&lt;script src&gt;</code> (exempt from that check, same as this file's own
    <code>&lt;link rel="stylesheet"&gt;</code> tags always have been), attaching to <code>globalThis</code>
    so both this page and <code>validate.ts</code> see the same function. Their <code>documents</code> argument
    here is just <code>[{ path: 'sample', dom: sample-instances }]</code>, a one-file stand-in for a real
    crawl. The samples were wired so extraction still produces one real violation per audit:
    <code>sample-observation</code> has no edges at all, and <code>sample-outcome</code> has only an
    outgoing edge (to <code>sample-action</code>), nothing pointing into it.
  </p>

  <pre id="audit-output">running&hellip;</pre>

  <script src="../../src/runtime.js"></script>
  <script type="module">
    const { loadCheck } = window.mycelium

    const documents = [{ path: 'sample', dom: document.getElementById('sample-instances') }]
```

Replace with:

```
<div class="live-demo">
  <h4>This section actually runs</h4>
  <p>
    Runs the exact two <code>data-audits</code> scripts above, not a hand-copied re-implementation &mdash;
    their source text is pulled straight from the <code>&lt;script&gt;</code> tags and dynamically
    <code>import()</code>ed from a <code>data:</code> URL via a local <code>loadCheck</code>, the same trick
    (and the same five lines) <a href="../specs/2026-07-23-mycelium-crawler.spec.html">the
    crawler</a> uses under Node in <code>utils.ts</code> &mdash; duplicated, not shared, since a real
    cross-file import would be CORS-checked with no stable origin to satisfy it over <code>file://</code>,
    and still works with a plain double-click either way. Their <code>documents</code> argument
    here is just <code>[{ path: 'sample', dom: sample-instances }]</code>, a one-file stand-in for a real
    crawl. The samples were wired so extraction still produces one real violation per audit:
    <code>sample-observation</code> has no edges at all, and <code>sample-outcome</code> has only an
    outgoing edge (to <code>sample-action</code>), nothing pointing into it.
  </p>

  <pre id="audit-output">running&hellip;</pre>

  <script type="module">
    async function loadCheck(scriptSource) {
      const mod = await import(`data:text/javascript,${encodeURIComponent(scriptSource)}`)
      return mod.check
    }

    const documents = [{ path: 'sample', dom: document.getElementById('sample-instances') }]
```

(Everything after this line — the rest of the script block computing `orphansSource`/`danglingSource`/running the two audits/writing `#audit-output` — is unchanged. Only the script-loading preamble changes.)

- [ ] **Step 2: Delete runtime.js and runtime.d.ts**

```bash
cd experiments/v4
git rm src/runtime.js src/runtime.d.ts
```

- [ ] **Step 3: Verify no file in `src/` still references `runtime.js`**

```bash
grep -rn "runtime" src/
```

Expected: no output. If anything prints, stop — a Node-side reference was missed (should have been caught in Task 1, but confirm before proceeding).

- [ ] **Step 4: Verify `pnpm validate` still passes**

```bash
pnpm validate
```

Expected: same count as before this task, `0 fail` — this task's HTML/JS changes are both inside a `data-audits` script's sibling live-demo `<div>`, not the audit script itself, so per-instance/audit validation is unaffected either way; this just confirms nothing else broke.

- [ ] **Step 5: Verify the live demo actually works, by opening it in a real browser**

```bash
open docs/templates/knowledge.template.html
```

Scroll to the "Graph-wide audits" section's live demo (the second one, below the six-sample-instances demo) and confirm the `<pre id="audit-output">` block reads two lines, both ending in `PASS (matches expected)`:

```
orphans-except-goal: violations = [sample-observation]  PASS (matches expected)
dangling-outcome:    violations = [sample-outcome]  PASS (matches expected)
```

This is the one step in this whole plan that cannot be verified from the command line — the inlined `loadCheck` only runs in a browser context, and there is no headless-browser tooling in this project. If you cannot open a real browser in your environment, report this step's verification as skipped/unavailable rather than claiming it passed — do not infer success from the Node-side checks above, which do not exercise this code path at all.

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git rm src/runtime.js src/runtime.d.ts 2>/dev/null || true   # if not already staged from Step 2
git commit -m "experiment(v4): inline the browser loadCheck, delete runtime.js/runtime.d.ts

The one browser call site left (this page's own graph-wide-audits
live demo) gets its own five-line copy of loadCheck instead of
loading it from a shared file — the same data: URL trick either side
already relied on, just no longer coordinated through a file both
sides have to load specially. With no consumers left, runtime.js and
its .d.ts are deleted outright, not deprecated."
```

---

### Task 3: Update living docs, log the new decision node

**Files:**
- Modify: `experiments/v4/README.md`
- Add: `experiments/v4/docs/knowledge/duplicate-not-share-loadcheck.decision.html`
- Modify: `experiments/v4/docs/knowledge/remove-runtime-js.goal.html` (add a link)

**Interfaces:**
- Consumes: nothing from other tasks directly (documentation/graph work), but describes what Tasks 1-2 actually built, so should land after them.
- Produces: nothing later tasks consume — this is the last task.

- [ ] **Step 1: Update `README.md`'s layout listing**

In `experiments/v4/README.md`, find:

```
src/             Node-only, reads/writes docs/, never opened as a webpage
  validate.ts    reads: validate + audit every document
  run.ts         writes: `run <id> <command> [args]`, template-declared authoring
  runtime.js     shared script-execution helper, loaded by validate.ts, run.ts,
                 and one browser-facing live demo — no `export`, on purpose,
                 see "Opening the documents directly" below
  runtime.d.ts   types for runtime.js's globalThis.mycelium, editor-only
```

Replace with:

```
src/             Node-only, reads/writes docs/, never opened as a webpage
  validate.ts    reads: validate + audit every document
  run.ts         writes: `run <id> <command> [args]`, template-declared authoring
  utils.ts       shared helpers: HTML parsing, template resolution, per-instance
                 validation, stdin reading, and the data: URL script loader — see
                 "Opening the documents directly" below
```

- [ ] **Step 2: Update the "Opening the documents directly" section**

Find:

```
## Opening the documents directly

Every file under `docs/` is meant to be opened straight in a browser, no
server required — no exceptions. That's why `src/runtime.js`, the one bit
of code shared between the crawler and a browser live demo, has no
`export`: a real ES module import is CORS-checked even for local files, and
`file://` has no stable origin to satisfy that check. Loaded instead as a
classic `<script src>` (exempt from that check, same as this project's
`<link rel="stylesheet">` tags always have been) that attaches to
`globalThis`, so both sides see the same function without either one
needing a server.
```

Replace with:

```
## Opening the documents directly

Every file under `docs/` is meant to be opened straight in a browser, no
server required — no exceptions. A real ES module import is CORS-checked
even for local files, and `file://` has no stable origin to satisfy that
check — which is why the one thing that would otherwise need importing
across the Node/browser boundary (a five-line `data:` URL script loader)
isn't imported at all: it's written once in `src/utils.ts` for the Node
side, and duplicated directly inline in the one browser-facing live demo
that needs it, rather than shared through a file either side would have to
import.
```

- [ ] **Step 3: Verify no living doc still mentions `runtime.js`**

```bash
cd experiments/v4
grep -n "runtime" README.md
grep -n "runtime\.js\|runtime\.d\.ts" docs/templates/knowledge.template.html
```

Expected: no output from either command.

```bash
grep -rln "runtime\.js" docs/specs/ docs/knowledge/
```

Expected: some matches (the frozen specs and historical knowledge nodes listed in the spec's problem statement) — these should NOT have changed; this command is confirming they still exist untouched, not that they're empty.

- [ ] **Step 4: Log the new decision node and link it**

```bash
pnpm mycelium knowledge add decision \
  --title "Duplicate loadModule/loadCheck rather than share it, once runtime.js's whole reason for existing was one five-line function" \
  --confidence 80 --status completed --file duplicate-not-share-loadcheck

pnpm mycelium knowledge link duplicate-not-share-loadcheck.decision.html reverse-runtime-to-globalthis.decision.html \
  --rel elaborates --label "answers a narrower question than that decision did -- not how to share across Node/browser without CORS, but whether a five-line function with two call sites needs sharing machinery at all"

pnpm mycelium knowledge link remove-runtime-js.goal.html duplicate-not-share-loadcheck.decision.html \
  --rel leads_to --label "the goal's core decision: write it twice instead of sharing it"
```

- [ ] **Step 5: Validate and verify the real repo is otherwise unaffected**

```bash
pnpm validate
```

Expected: count one higher than before this task (the new decision node), `0 fail`.

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/README.md experiments/v4/docs/knowledge/duplicate-not-share-loadcheck.decision.html experiments/v4/docs/knowledge/remove-runtime-js.goal.html
git commit -m "docs(v4): update README for the utils.ts/runtime.js change, log the new decision

README's layout listing and \"Opening the documents directly\" section
both explained the old shared-file mechanism in detail; reframed to
describe the current one (written twice, not shared) while keeping
the still-true CORS/file:// reasoning underneath it. Every frozen
spec and knowledge/*.html node that mentions runtime.js is
deliberately left untouched, per this project's established
living-vs-historical convention. New decision node records the
narrower question this work actually answered, linked to
reverse-runtime-to-globalthis.decision.html with elaborates rather
than editing that node or contradicting it."
```

---

## Self-Review Notes

- **Spec coverage:** "Don't share it — write it twice" (Node-side move + typed exports) → Task 1. "runtime.js and runtime.d.ts are deleted, not deprecated" → Task 2 (deletion gated on the browser consumer being replaced first). "fs-helpers.ts renamed to utils.ts" → Task 1. "Documentation: keep the still-true part, drop the shared-file framing" → Task 2 (live-demo prose) + Task 3 (README). "Knowledge graph: a new decision, not an edit to the old one" → Task 3. Both `<spec-out-of-scope>` items (not revisiting file:///CORS generally, not building spec.template.html's commands) correctly appear nowhere in any task.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable. Step 5 of Task 2 is the one step that can't be verified from a command line at all — stated explicitly as such, with instructions to report it as skipped rather than claim success, rather than leaving that gap implicit.
- **Type consistency:** `loadModule`/`loadCheck`'s signatures in Task 1's `utils.ts` are copied verbatim from `runtime.d.ts`'s current declaration (checked against the real file before writing this plan). Task 1's `validateInstance` calls the local `loadCheck` (no `globalThis` prefix) — matches how `run.ts`/`validate.ts` are also updated to import directly rather than destructure a global. Task 2's inlined browser `loadCheck` is byte-identical in logic to `utils.ts`'s own (just untyped, since it's plain browser JS, not TypeScript) — deliberate duplication, not drift.
- **Ordering:** strictly sequential. Task 2's deletion step depends on Task 1 having removed every Node-side `runtime.js` reference first (verified by Task 2 Step 3's repo-wide grep, which would fail loudly if Task 1 were skipped or incomplete). Task 3 describes the end state of Tasks 1-2, so it must run last.
