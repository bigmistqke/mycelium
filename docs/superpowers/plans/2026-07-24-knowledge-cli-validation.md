# Knowledge CLI Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `add`, `link`, `update`, and `list` validate their own input before acting — reusing the six existing `data-validates` scripts as the single source of truth for `add`/`update`, adding a small required-argument guard for what no validator can catch, giving `list` `--status`/`--type` filters, and making every command fail the same clean way (one message, exit 1, nothing written) instead of crashing or silently writing bad data.

**Architecture:** Four small, sequential changes to three files. `src/fs-helpers.ts` gains a moved-in `resolveTemplateRef` and a new `validateInstance` (single-node validation, reusing the same resolve→load→check path `validate.ts` already has for its whole-corpus pass). `src/run.ts` wires a `validate` closure through to every command as a third argument, and wraps command dispatch in one `try/catch` for clean errors. `docs/templates/knowledge.template.html`'s `mycelium/command` script gets a `requireArgs` guard and updated `add`/`link`/`update`/`list` bodies.

**Tech Stack:** Node ≥24, TypeScript via Node's native type stripping (no build step), happy-dom (already a dependency). No test framework — verification is running the tool directly against scratch copies and inspecting output, same as every prior task in this project.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-24-mycelium-knowledge-cli-validation.spec.html` — read it before starting.
- No new dependencies.
- No new schema table anywhere. The six `data-validates` scripts in `knowledge.template.html` remain the only place "what fields does a type allow" is defined — `add`/`update` must reuse them via `validateInstance`, never re-derive or duplicate that list.
- `--help`'s positional-only quirk (`mycelium run knowledge list nodes --help` silently runs `list nodes` instead of printing help) is explicitly out of scope. Do not fix it in any task.
- **`run.ts` always resolves `docs/` relative to the current working directory** (`resolvePath("./docs")`, hardcoded, no directory argument) — unlike `validate.ts`, which accepts one. Every scratch-copy verification step in this plan that invokes `node .../src/run.ts` runs it with the scratch copy as the current directory (a `(cd "$SCRATCH" && node "$RUN" …)` subshell, or equivalent) — never by passing the scratch path as an argument, since `run.ts` has no such argument and would silently operate on the real `experiments/v4/docs/` instead. Getting this wrong mutates the real repository — it happened once already while investigating the bugs this plan fixes, and was reverted with `git checkout`.
- Run all `pnpm`/`node` commands from `experiments/v4/`, except the scratch-copy subshells above, which set their own directory.
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go, the same way prior work in this repo did.

---

### Task 1: Move `resolveTemplateRef` into `fs-helpers.ts`, add `validateInstance`

**Files:**
- Modify: `experiments/v4/src/fs-helpers.ts`
- Modify: `experiments/v4/src/validate.ts` (imports only, plus deleting its now-duplicate local function)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `resolveTemplateRef(instanceFile: string, conformsTo: string): string` and `validateInstance(docsDir: string, instancePath: string, element: Element): Promise<{ ok: boolean; errors: string[] }>`, both exported from `experiments/v4/src/fs-helpers.ts`. Task 2 imports `validateInstance`.

- [ ] **Step 1: Replace `fs-helpers.ts` in full**

`experiments/v4/src/fs-helpers.ts` currently reads:

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

Replace the entire file with:

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

  const { document } = parseHTML(readFileSync(templateFile, "utf8"))
  const scriptSource = (document as unknown as Document)
    .querySelector(`script[data-validates="#${fragId}"]`)
    ?.textContent

  if (!scriptSource) return { ok: false, errors: [`no template found at ${key}`] }

  try {
    const check = await globalThis.mycelium.loadCheck(scriptSource)
    const result = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    return { ok: result.ok, errors: (result.errors ?? result.violations ?? []) as string[] }
  } catch (err) {
    return { ok: false, errors: [`validator threw — ${(err as Error).message}`] }
  }
}
```

- [ ] **Step 2: Update `validate.ts` to import the shared `resolveTemplateRef`**

In `experiments/v4/src/validate.ts`, find:

```ts
import { readFileSync } from "node:fs"
import { styleText } from "node:util"
import { dirname, resolve as resolvePath, sep } from "node:path"
import { parseHTML, walkHtmlFiles } from "./fs-helpers.ts"
import "./runtime.js"
```

Replace with:

```ts
import { readFileSync } from "node:fs"
import { styleText } from "node:util"
import { resolve as resolvePath, sep } from "node:path"
import { parseHTML, walkHtmlFiles, resolveTemplateRef } from "./fs-helpers.ts"
import "./runtime.js"
```

(`dirname` is dropped — its only use in this file was the local `resolveTemplateRef`, deleted next.)

- [ ] **Step 3: Delete `validate.ts`'s now-duplicate local `resolveTemplateRef`**

Find:

```ts
function discoverInstances(documents: ParsedDoc[]): Instance[] {
  const instances: Instance[] = []
  for (const { path, dom } of documents) {
    for (const el of Array.from(dom.querySelectorAll("[data-conforms-to]"))) {
      instances.push({ file: path, element: el, conformsTo: el.getAttribute("data-conforms-to")! })
    }
  }
  return instances
}

function resolveTemplateRef(instanceFile: string, conformsTo: string): string {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

async function main() {
```

Replace with:

```ts
function discoverInstances(documents: ParsedDoc[]): Instance[] {
  const instances: Instance[] = []
  for (const { path, dom } of documents) {
    for (const el of Array.from(dom.querySelectorAll("[data-conforms-to]"))) {
      instances.push({ file: path, element: el, conformsTo: el.getAttribute("data-conforms-to")! })
    }
  }
  return instances
}

async function main() {
```

- [ ] **Step 4: Verify `fs-helpers.ts` loads and exports both functions**

```bash
cd experiments/v4
node -e "import('./src/fs-helpers.ts').then(m => console.log(Object.keys(m)))"
```

Expected: `[ 'parseHTML', 'walkHtmlFiles', 'resolveTemplateRef', 'validateInstance' ]` (order may vary) — proves the file has no syntax errors and both new/moved functions are real exports.

- [ ] **Step 5: Verify `validate.ts` still behaves identically**

```bash
pnpm validate
```

Expected: `61 checked, 0 fail` — the exact same count as before this change (this task is a pure refactor: moving a pure function and adding a new, not-yet-called one must not change `validate.ts`'s behavior at all).

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/src/fs-helpers.ts experiments/v4/src/validate.ts
git commit -m "experiment(v4): move resolveTemplateRef into fs-helpers.ts, add validateInstance

resolveTemplateRef was validate.ts's own private helper for resolving a
data-conforms-to reference to its template file and fragment id --
exactly the lookup a single-node validation needs too. Moved it,
unchanged, into fs-helpers.ts (already shared between validate.ts and
run.ts) and added validateInstance alongside it: given one element and
the path of the file it lives in, resolves its reference, loads that
type's real data-validates script, and runs it. Not yet called from
anywhere -- this task only adds the capability."
```

---

### Task 2: Wire `validate` through `run.ts`, add a clean top-level error path

**Files:**
- Modify: `experiments/v4/src/run.ts`

**Interfaces:**
- Consumes: `validateInstance` from `experiments/v4/src/fs-helpers.ts` (Task 1).
- Produces: every command function loaded from a `type="mycelium/command"` script is now called as `run(fs, args, validate)`, where `validate: (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>`. Any error thrown by a command (by `validate`'s caller, by a future `requireArgs`, or by a plain filesystem error) now prints as one clean `stderr` line and exits 1, with nothing written. Tasks 3 and 4 rely on this third argument existing and on thrown errors being reported cleanly.

- [ ] **Step 1: Add the `validateInstance` import and the `Validate` type**

In `experiments/v4/src/run.ts`, find:

```ts
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { parse } from "acorn"
import { parseHTML, walkHtmlFiles } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium
```

Replace with:

```ts
import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join, dirname, relative as relativePath, resolve as resolvePath } from "node:path"
import { parse } from "acorn"
import { parseHTML, walkHtmlFiles, validateInstance } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>
```

- [ ] **Step 2: Pass `validate` as a third argument, and catch errors cleanly**

Find:

```ts
  const run = mod[command] as ((fs: Filesystem, args: ParsedArgs) => void | Promise<void>) | undefined
  if (typeof run !== "function") {
    console.error(`${templateLabel} has no "${command}" command\n`)
    printHelp(id, templateLabel, mod, source)
    process.exit(1)
  }

  const args = parseArgs(rest)

  // Generic path math for link-style commands: if two file arguments were
  // given (`link <from> <to> …`), precompute the relative href between
  // them so the command never has to know where either file lives on disk.
  if (args._.length >= 2) {
    const [from, to] = args._
    args.href = "./" + relativePath(dirname(resolvePath(docsDir, from)), resolvePath(docsDir, to))
  }

  const fs = new Filesystem(docsDir)
  await run(fs, args)
  fs.commit()
}
```

Replace with:

```ts
  const run = mod[command] as
    | ((fs: Filesystem, args: ParsedArgs, validate: Validate) => void | Promise<void>)
    | undefined
  if (typeof run !== "function") {
    console.error(`${templateLabel} has no "${command}" command\n`)
    printHelp(id, templateLabel, mod, source)
    process.exit(1)
  }

  const args = parseArgs(rest)

  // Generic path math for link-style commands: if two file arguments were
  // given (`link <from> <to> …`), precompute the relative href between
  // them so the command never has to know where either file lives on disk.
  if (args._.length >= 2) {
    const [from, to] = args._
    args.href = "./" + relativePath(dirname(resolvePath(docsDir, from)), resolvePath(docsDir, to))
  }

  const validate: Validate = (root, instancePath) => validateInstance(docsDir, instancePath, root)

  const fs = new Filesystem(docsDir)
  try {
    await run(fs, args, validate)
    fs.commit()
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
```

- [ ] **Step 3: Verify normal dispatch is unaffected**

```bash
cd experiments/v4
pnpm mycelium knowledge list nodes | head -3
```

Expected: the same kind of output as before this change (three tab-separated node lines) — proves passing a third `validate` argument doesn't break `list`, which doesn't use it (JS simply ignores extra arguments a function doesn't declare).

- [ ] **Step 4: Verify a plain filesystem error is now reported cleanly**

```bash
node src/run.ts knowledge update does-not-exist.goal.html --title x 2>&1
echo "exit: $?"
```

Expected: a short, clean message (Node's own `ENOENT: no such file or directory, open '.../does-not-exist.goal.html'` or similar) — **not** a multi-line stack trace — followed by `exit: 1`. This exercises the new `try/catch` even though Task 3 hasn't touched `update` yet: `fs.get()` already throws on a missing file, and that error now flows through the same clean path every other error will.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/src/run.ts
git commit -m "experiment(v4): wire a validate argument through run.ts, catch errors cleanly

Every command function now receives (fs, args, validate) instead of
just (fs, args) -- validate(root, instancePath) is a closure over
docsDir backed by fs-helpers.ts's validateInstance, letting a command
check one node's own type-validator before it's ever written. Neither
add, link, nor update calls it yet (that's Tasks 3-4); list ignores
the extra argument, unaffected. Also wraps the run()+commit() sequence
in one try/catch: any thrown error now prints as a single clean
message and exits 1, instead of the raw stack trace (with the whole
command script inlined as a data: URL) a crash produced before."
```

---

### Task 3: `add` and `update` validate before writing

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (the `mycelium/command` script only)

**Interfaces:**
- Consumes: the `validate` third argument from Task 2.
- Produces: a `requireArgs(...checks)` helper, defined once near the top of the `mycelium/command` script, that Task 4's `link` also uses.

- [ ] **Step 1: Add the `requireArgs` helper**

In `experiments/v4/docs/templates/knowledge.template.html`, find:

```
<script type="mycelium/command">
  const REQUIRES_STATUS = ['goal', 'decision', 'action']

  /**
   * Create a new knowledge-<type> node file.
```

Replace with:

```
<script type="mycelium/command">
  const REQUIRES_STATUS = ['goal', 'decision', 'action']

  // Throws a clean, specific error for the handful of arguments no
  // validator can ever catch (which file to write, which file to open,
  // whether --rel was given at all) — everything else is left to each
  // type's own knowledge-validates script, run via `validate` below.
  function requireArgs(...checks) {
    for (const [value, label] of checks) {
      if (value === undefined) throw new Error(`missing required argument: ${label}`)
    }
  }

  /**
   * Create a new knowledge-<type> node file.
```

- [ ] **Step 2: Replace `add`**

Find:

```
   * <type> is one of goal|decision|option|action|outcome|observation.
   * --status only applies to goal/decision/action (default "pending").
   * --prompt only applies to goal. --file is required and becomes
   * knowledge/<slug>.<type>.html.
   */
  export function add(fs, args) {
    const type = args._[0]
    const doc = fs.create(`knowledge/${args.file}.${type}.html`, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<link rel="stylesheet" href="../theme.css">
<link rel="stylesheet" href="../templates/knowledge.template.css">
</head>
<body>

<knowledge-${type} data-conforms-to="../templates/knowledge.template.html#knowledge-${type}">
</knowledge-${type}>

</body>
</html>
`)

    const pageTitle = `${type[0].toUpperCase()}${type.slice(1)}: ${args.title}`
    doc.querySelector('title').textContent = pageTitle

    const root = doc.querySelector(`knowledge-${type}`)
    const field = (tag, text) => {
      if (!text) return
      const el = doc.createElement(tag)
      el.textContent = text
      root.appendChild(el)
    }

    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence ?? '70')
    if (REQUIRES_STATUS.includes(type)) field('knowledge-status', args.status ?? 'pending')
    if (type === 'goal') field('knowledge-prompt', args.prompt)
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)
  }
```

Replace with:

```
   * <type> is one of goal|decision|option|action|outcome|observation.
   * --status only applies to goal/decision/action (default "pending").
   * --prompt only applies to goal. --file is required and becomes
   * knowledge/<slug>.<type>.html. The built node is validated against
   * its own type's validator before being written — an unrecognized
   * <type>, a missing required field, or a field the type doesn't allow
   * is rejected and nothing is written.
   */
  export async function add(fs, args, validate) {
    requireArgs([args.file, '--file'])
    const type = args._[0]
    const path = `knowledge/${args.file}.${type}.html`
    const doc = fs.create(path, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<link rel="stylesheet" href="../theme.css">
<link rel="stylesheet" href="../templates/knowledge.template.css">
</head>
<body>

<knowledge-${type} data-conforms-to="../templates/knowledge.template.html#knowledge-${type}">
</knowledge-${type}>

</body>
</html>
`)

    // type is unchecked above, deliberately — String(type) keeps this line
    // from throwing when <type> was never passed at all (args._[0] is
    // undefined); an unrecognized or missing type is instead caught by
    // validate() below, the same way a typo'd type would be.
    const typeLabel = String(type)
    const pageTitle = `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)}: ${args.title}`
    doc.querySelector('title').textContent = pageTitle

    const root = doc.querySelector(`knowledge-${type}`)
    const field = (tag, text) => {
      if (!text) return
      const el = doc.createElement(tag)
      el.textContent = text
      root.appendChild(el)
    }

    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence ?? '70')
    if (REQUIRES_STATUS.includes(type)) field('knowledge-status', args.status ?? 'pending')
    if (type === 'goal') field('knowledge-prompt', args.prompt)
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)

    const result = await validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }
```

- [ ] **Step 3: Replace `update`**

Find:

```
   * <file> is an existing knowledge/<slug>.<type>.html file; its type is
   * read off its own root element, not passed again. Per flag: omitted
   * leaves the field untouched, any other value upserts it (overwrite if
   * the tag is already present, append if not), and an explicit empty
   * value ("") removes the field entirely.
   */
  export function update(fs, args) {
    const doc = fs.get(`knowledge/${args._[0]}`)
    const root = doc.querySelector('[data-conforms-to]')

    const field = (tag, text) => {
      if (text === undefined) return
      const existing = root.querySelector(tag)
      if (text === '') {
        existing?.remove()
        return
      }
      if (existing) existing.textContent = text
      else {
        const el = doc.createElement(tag)
        el.textContent = text
        root.appendChild(el)
      }
    }

    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence)
    field('knowledge-status', args.status)
    field('knowledge-prompt', args.prompt)
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)
  }
```

Replace with:

```
   * <file> is an existing knowledge/<slug>.<type>.html file; its type is
   * read off its own root element, not passed again. Per flag: omitted
   * leaves the field untouched, any other value upserts it (overwrite if
   * the tag is already present, append if not), and an explicit empty
   * value ("") removes the field entirely. The resulting node is
   * validated against its own type's validator before being written —
   * a disallowed field, or a required field left empty, is rejected and
   * the file on disk is left untouched.
   */
  export async function update(fs, args, validate) {
    requireArgs([args._[0], '<file>'])
    const path = `knowledge/${args._[0]}`
    const doc = fs.get(path)
    const root = doc.querySelector('[data-conforms-to]')

    const field = (tag, text) => {
      if (text === undefined) return
      const existing = root.querySelector(tag)
      if (text === '') {
        existing?.remove()
        return
      }
      if (existing) existing.textContent = text
      else {
        const el = doc.createElement(tag)
        el.textContent = text
        root.appendChild(el)
      }
    }

    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence)
    field('knowledge-status', args.status)
    field('knowledge-prompt', args.prompt)
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)

    const result = await validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }
```

- [ ] **Step 4: Verify a valid `add` still works, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "scratch test" --confidence 60 --file scratch-test)
```

Expected: `wrote    knowledge/scratch-test.observation.html`.

```bash
node "$VALIDATE" "$SCRATCH/docs"
```

Expected: `62 checked, 0 fail` (one more than the real repo's 61, from the new valid observation).

- [ ] **Step 5: Verify a disallowed field is rejected, nothing written**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge add goal --title "bad goal" --confidence 50 --commit abc1234 --file bad-goal-test 2>&1)
echo "exit: $?"
ls "$SCRATCH/docs/knowledge" | grep bad-goal-test
```

Expected: the error output contains `unexpected <knowledge-commit> on knowledge-goal`, `exit: 1`, and the final `ls | grep` prints **nothing** — no `bad-goal-test.goal.html` file exists anywhere in the scratch copy.

- [ ] **Step 6: Verify an unknown type is rejected the same way**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge add nonsense --title "bad type" --confidence 50 --file bad-type-test 2>&1)
echo "exit: $?"
ls "$SCRATCH/docs/knowledge" | grep bad-type-test
```

Expected: error output contains `no template found at`, `exit: 1`, and no `bad-type-test.*.html` file exists.

- [ ] **Step 7: Verify a missing `--file` is rejected before anything else runs**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "no file arg" --confidence 50 2>&1)
echo "exit: $?"
```

Expected: `missing required argument: --file`, `exit: 1`.

- [ ] **Step 8: Verify `update` rejects a disallowed field, leaves the file untouched**

```bash
cp "$SCRATCH/docs/knowledge/build-v4.goal.html" /tmp/build-v4-before.html
(cd "$SCRATCH" && node "$RUN" knowledge update build-v4.goal.html --commit abc1234 2>&1)
echo "exit: $?"
diff /tmp/build-v4-before.html "$SCRATCH/docs/knowledge/build-v4.goal.html"
rm /tmp/build-v4-before.html
```

Expected: error output contains `unexpected <knowledge-commit> on knowledge-goal`, `exit: 1`, and `diff` prints **nothing** (the file is byte-for-byte unchanged).

- [ ] **Step 9: Clean up the scratch copy, verify the real repo still passes**

```bash
rm -rf "$SCRATCH"
cd experiments/v4
pnpm validate
```

Expected: `61 checked, 0 fail` — unchanged, since every Step 4-8 write happened only inside the now-deleted scratch copy.

- [ ] **Step 10: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): add and update validate before writing

Both commands now build/mutate their node exactly as before, then run
it through validate() — the same real per-type validator pnpm validate
already uses — before anything is written. A disallowed field, an
unrecognized type, or a required field left empty is rejected with the
validator's own error message and nothing is written, instead of only
surfacing on a later pnpm validate run. requireArgs, a small local
guard, covers the one thing no validator can: add now requires --file
up front, since no filename means no path to even construct a node
at. update requires its target <file>."
```

---

### Task 4: `link` requires its arguments and confirms both files exist; `list` gets filters

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (the `mycelium/command` script only)

**Interfaces:**
- Consumes: the `requireArgs` helper from Task 3 (already present in the file this task's implementer receives).
- Produces: nothing later tasks consume — this is the last task.

- [ ] **Step 1: Replace `link`**

Find:

```
   * <rel> is one of depends_on|blocks|supports|contradicts|alternative_to|
   * leads_to, or a new label if the project genuinely needs one — the
   * vocabulary is open. Appends
   * <a data-rel="<rel>" href="<relative path to to-file>">label</a>
   * to <from-file>, right before its closing tag.
   */
  export function link(fs, args) {
    const doc = fs.get(`knowledge/${args._[0]}`)
    const root = doc.querySelector('[data-conforms-to]')
    const a = doc.createElement('a')
    a.setAttribute('data-rel', args.rel)
    a.setAttribute('href', args.href)
    a.textContent = args.label ?? args._[2] ?? ''
    root.appendChild(a)
  }
```

Replace with:

```
   * <rel> is one of depends_on|blocks|supports|contradicts|alternative_to|
   * leads_to, or a new label if the project genuinely needs one — the
   * vocabulary is open. Appends
   * <a data-rel="<rel>" href="<relative path to to-file>">label</a>
   * to <from-file>, right before its closing tag. Both <from-file> and
   * <to-file> must already exist.
   */
  export function link(fs, args) {
    requireArgs([args._[0], '<from-file>'], [args._[1], '<to-file>'], [args.rel, '--rel'])
    fs.get(`knowledge/${args._[1]}`)
    const doc = fs.get(`knowledge/${args._[0]}`)
    const root = doc.querySelector('[data-conforms-to]')
    const a = doc.createElement('a')
    a.setAttribute('data-rel', args.rel)
    a.setAttribute('href', args.href)
    a.textContent = args.label ?? args._[2] ?? ''
    root.appendChild(a)
  }
```

- [ ] **Step 2: Replace `list`**

Find:

```
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
    // Titles/labels are free text and often wrap across multiple indented
    // source lines; collapse embedded whitespace so each node/edge still
    // prints as exactly one line, matching this command's own contract.
    const oneLine = (text) => text.trim().replace(/\s+/g, ' ')

    if (kind === 'nodes') {
      for (const { path, doc } of documents) {
        const el = doc.querySelector('[data-conforms-to]')
        if (!el) continue
        const type = el.tagName.toLowerCase()
        const family = type.split('-')[0]
        const title = oneLine(el.querySelector(`${family}-title`)?.textContent ?? '')
        const status = oneLine(el.querySelector(`${family}-status`)?.textContent ?? '')
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
          console.log(`${path}  --${rel}-->  ${href}  ${oneLine(a.textContent ?? '')}`)
        }
      }
      return
    }

    console.error(`unknown list kind "${kind}" — expected "nodes" or "edges"`)
  }
```

Replace with:

```
  /**
   * List every node or edge in the real knowledge graph (docs/knowledge/).
   *
   *   mycelium run knowledge list nodes [--status S] [--type T]
   *   mycelium run knowledge list edges
   *
   * nodes: one line per file — path, type (read off the root element's
   * own tag name), status (blank if the type has none), title.
   * --status and --type optionally filter which nodes print; --type
   * matches the bare type (e.g. "goal", not "knowledge-goal"), the same
   * form `add <type>` takes.
   * edges: one line per <a data-rel> found — source file, rel, href,
   * label text.
   */
  export function list(fs, args) {
    const kind = args._[0]
    const documents = fs.list('knowledge')
    // Titles/labels are free text and often wrap across multiple indented
    // source lines; collapse embedded whitespace so each node/edge still
    // prints as exactly one line, matching this command's own contract.
    const oneLine = (text) => text.trim().replace(/\s+/g, ' ')

    if (kind === 'nodes') {
      for (const { path, doc } of documents) {
        const el = doc.querySelector('[data-conforms-to]')
        if (!el) continue
        const type = el.tagName.toLowerCase()
        const family = type.split('-')[0]
        const status = oneLine(el.querySelector(`${family}-status`)?.textContent ?? '')
        if (args.status !== undefined && status !== args.status) continue
        if (args.type !== undefined && type !== `${family}-${args.type}`) continue
        const title = oneLine(el.querySelector(`${family}-title`)?.textContent ?? '')
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
          console.log(`${path}  --${rel}-->  ${href}  ${oneLine(a.textContent ?? '')}`)
        }
      }
      return
    }

    throw new Error(`unknown list kind "${kind}" — expected "nodes" or "edges"`)
  }
```

- [ ] **Step 3: Verify `link` without `--rel` is rejected, nothing written**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cp "$SCRATCH/docs/knowledge/build-v4.goal.html" /tmp/build-v4-before.html

(cd "$SCRATCH" && node "$RUN" knowledge link build-v4.goal.html html-as-store.decision.html 2>&1)
echo "exit: $?"
diff /tmp/build-v4-before.html "$SCRATCH/docs/knowledge/build-v4.goal.html"
```

Expected: `missing required argument: --rel`, `exit: 1`, and `diff` prints nothing (in particular, no `data-rel="undefined"` was written — this is the exact bug from the spec's problem statement).

- [ ] **Step 4: Verify `link` to a nonexistent file is rejected, nothing written**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge link build-v4.goal.html does-not-exist.decision.html --rel depends_on 2>&1)
echo "exit: $?"
diff /tmp/build-v4-before.html "$SCRATCH/docs/knowledge/build-v4.goal.html"
```

Expected: a clean `ENOENT`-style error naming `does-not-exist.decision.html`, `exit: 1`, and `diff` prints nothing.

- [ ] **Step 5: Verify a valid `link` still works**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge link build-v4.goal.html html-as-store.decision.html --rel supports --label "scratch test edge")
grep "scratch test edge" "$SCRATCH/docs/knowledge/build-v4.goal.html"
rm /tmp/build-v4-before.html
```

Expected: `wrote    knowledge/build-v4.goal.html`, and the `grep` finds the new `<a data-rel="supports" …>scratch test edge</a>` line.

- [ ] **Step 6: Verify `list`'s `--status` and `--type` filters, and its exit code on a bad kind**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge list nodes --status completed) | awk -F'\t' '{ if ($3 != "completed") print "FAIL: " $0 }'
```

Expected: no output (every printed line's status column is exactly `completed`).

```bash
(cd "$SCRATCH" && node "$RUN" knowledge list nodes --type goal) | awk -F'\t' '{ if ($2 != "knowledge-goal") print "FAIL: " $0 }'
```

Expected: no output (every printed line's type column is exactly `knowledge-goal`).

```bash
(cd "$SCRATCH" && node "$RUN" knowledge list bogus 2>&1)
echo "exit: $?"
```

Expected: `unknown list kind "bogus" — expected "nodes" or "edges"`, `exit: 1` (previously this printed the same message but exited 0).

- [ ] **Step 7: Clean up, verify the real repo still passes, verify `--help` output still works**

```bash
rm -rf "$SCRATCH"
cd experiments/v4
pnpm validate
```

Expected: `61 checked, 0 fail` — unchanged.

```bash
pnpm mycelium knowledge --help
```

Expected: prints all four commands (`add`, `link`, `update`, `list`) with their doc comments, same as before this plan — confirms `run.ts`'s acorn-based doc extraction still works correctly against the updated script (in particular, that `export async function add(fs, args, validate)` is still recognized as a named export the same way the previous `export function add(fs, args)` was).

- [ ] **Step 8: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): link requires its arguments, confirms both files exist; list gets filters

link now throws a clean error if <from-file>, <to-file>, or --rel is
missing, instead of the --rel case silently writing a literal
data-rel=\"undefined\" edge to disk (hit for real against this
project's own graph while investigating this exact bug). It also
confirms <to-file> exists via fs.get() before touching anything --
the same existence check <from-file> already got for free, just
applied to both sides now. list gains --status/--type filters, and
its existing bad-kind message now throws (exit 1) instead of logging
and returning 0."
```

---

## Self-Review Notes

- **Spec coverage:** "Reuse the six validators, don't invent a second schema" → Task 1 (`validateInstance`) + Task 3 (`add`/`update` call it). "Abort-on-invalid costs nothing extra" → verified structurally in Task 3 Steps 5/6/7/8 (nothing written on rejection) and Task 4 Steps 3/4, with no new rollback code anywhere, matching the spec's claim that this falls out of `run.ts`'s existing `run()`-then-`commit()` sequencing. "Required-argument checks, only where a validator can't cover it" → Task 3 Step 1 (`requireArgs`) + Task 3 Steps 2-3 (`add`/`update`'s single `--file`/`<file>` checks) + Task 4 Step 1 (`link`'s three checks, plus the folded-in `<to-file>` existence check). "`list`: filters and a failing exit code" → Task 4 Step 2. "One clean error path for every command" → Task 2 Step 2. Both `<spec-out-of-scope>` items (no new schema table, `--help` quirk untouched) → correctly absent from every task, called out in Global Constraints instead.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable; every verification step names an exact expected output rather than "check it works."
- **Type consistency:** `Validate` (Task 2) is `(root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>`, matching `validateInstance`'s actual return type from Task 1 exactly (both defined as `Promise<{ ok: boolean; errors: string[] }>`, not just structurally similar). `add`/`update`'s `validate(root, path)` calls (Task 3) pass a `path` variable of the same shape (`knowledge/<slug>.<type>.html` / `knowledge/<file>`) `validateInstance` expects as `instancePath` (resolved against `docsDir`, matching how `fs.create`/`fs.get` already address the same files). `requireArgs`'s `[value, label]` tuple convention (defined Task 3 Step 1) is used identically at every call site across Tasks 3 and 4.
- **Task-4-depends-on-Task-3 ordering:** Task 4's `link` change calls `requireArgs`, defined in Task 3 Step 1 — Task 4 is written assuming Task 3 has already landed in the file, and its Interfaces block says so explicitly; these two tasks must run in order, not in parallel.
