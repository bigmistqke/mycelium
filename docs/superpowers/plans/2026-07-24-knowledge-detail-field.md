# Knowledge Detail Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `knowledge-detail`, a free-form elaboration field (real markup, including `<script>`, no tag allowlist) to all six `knowledge-*` types, authorable through `add`/`update` via one flag (`--detail`, where the literal value `-` means read stdin), and switch every command's parameter passing from a growing positional list to one destructured context object.

**Architecture:** Four sequential changes. `src/run.ts` gains a `Cli` bundle (`{ validate, readStdin }`) and a single `CommandContext` object (`{ fs, args, cli }`) replacing today's three positional parameters — this touches all four existing commands' signatures, not just the two that need `cli`. `src/fs-helpers.ts` gains `readStdin`. `docs/templates/knowledge.template.html` gets the schema addition (all six `<template>`/validator pairs) and the `add`/`update`/`list` wiring.

**Tech Stack:** Node ≥24, TypeScript via native type stripping, happy-dom (already a dependency). No test framework — verification is running the tool directly against scratch copies, same as every prior task in this project.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-24-mycelium-knowledge-detail-field.spec.html` — read it before starting. Note it was revised twice after initial approval (both times committed): the CLI collapsed from two flags to one, and this plan additionally moves parameter-passing from positional args to a single destructured `{ fs, args, cli }` object, decided after the spec was written. Trust this plan's code over the spec's code samples where the two differ on parameter shape.
- No new dependencies.
- `knowledge-detail` content model: free-form, no tag or markup restriction (including `<script>`), validated only for "present and non-empty if present" — matching `spec-design`/`spec-problem`'s existing validator treatment exactly. Do not add a tag allowlist.
- `readStdin` is the only new shared primitive. The `-` interpretation ("this flag's value is exactly `-`, so read stdin") stays inline in `add`/`update` themselves, not hidden in a generically-named resolver function — it is not a generic CLI-wide rule, and must not be applied to any flag other than `--detail`.
- Insertion into `<knowledge-detail>` uses `.innerHTML =`, never `.textContent =` (the latter would flatten real markup back to escaped text, defeating the field's purpose). `field()`'s existing `.textContent =` behavior for every other field is unchanged.
- Every command function's parameter list becomes a single destructured object: `({ fs, args, cli })` for `add`/`update`, `({ fs, args })` for `link`/`list` (which don't need `cli`). `run.ts`'s dispatch changes from `run(fs, args, validate)` to `run({ fs, args, cli })` accordingly — this is a refactor of already-shipped code from the previous plan, not new-feature work, and must land cleanly (no lingering positional call sites).
- Run all `pnpm`/`node` commands from `experiments/v4/`, except scratch-copy verification steps, which use a `(cd "$SCRATCH" && node "$RUN" …)` subshell — `run.ts` always resolves `docs/` relative to the current working directory, with no directory argument, unlike `validate.ts`. Getting this wrong mutates the real repository (it happened once already this session).
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go.

---

### Task 1: `Cli` bundle and `CommandContext` — `run.ts` + `readStdin` in `fs-helpers.ts`

**Files:**
- Modify: `experiments/v4/src/fs-helpers.ts` (add `readStdin`)
- Modify: `experiments/v4/src/run.ts` (add `Cli`/`CommandContext`, change dispatch shape)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `readStdin(): Promise<string>` exported from `fs-helpers.ts`. Every command function is now called as `run({ fs, args, cli })`, where `cli: { validate: Validate; readStdin: () => Promise<string> }`. Tasks 2-4 rely on this shape existing.

- [ ] **Step 1: Add `readStdin` to `fs-helpers.ts`**

In `experiments/v4/src/fs-helpers.ts`, find the end of the file:

```ts
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
```

Add this immediately after it:

```ts

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

- [ ] **Step 2: Add the `Cli`/`CommandContext` types and import `readStdin` in `run.ts`**

Find:

```ts
import { parseHTML, walkHtmlFiles, validateInstance } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>
```

Replace with:

```ts
import { parseHTML, walkHtmlFiles, validateInstance, readStdin } from "./fs-helpers.ts"
import "./runtime.js"

const { loadModule } = globalThis.mycelium

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>

interface Cli {
  validate: Validate
  readStdin: () => Promise<string>
}

interface CommandContext {
  fs: Filesystem
  args: ParsedArgs
  cli: Cli
}
```

(`Filesystem` and `ParsedArgs` are declared later in the file — that's fine, this is a `type`/`interface` position, not executed code, and TypeScript resolves both regardless of declaration order within a module.)

- [ ] **Step 3: Change the dispatch cast and call to the single-object shape**

Find:

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

Replace with:

```ts
  const run = mod[command] as ((ctx: CommandContext) => void | Promise<void>) | undefined
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
  const cli: Cli = { validate, readStdin }

  const fs = new Filesystem(docsDir)
  try {
    await run({ fs, args, cli })
    fs.commit()
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Update the four command signatures in `knowledge.template.html` to the destructured shape (no behavior change yet)**

This step only changes *how each command receives its arguments* — nothing about what `add`/`update`/`link`/`list` actually do changes in this task. `--detail` wiring is Task 3.

In `experiments/v4/docs/templates/knowledge.template.html`, find:

```js
  export async function add(fs, args, validate) {
```

Replace with:

```js
  export async function add({ fs, args, cli }) {
```

Find (still inside `add`, unchanged apart from this one line):

```js
    const result = await validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }

  /**
   * Add a data-rel edge from one existing node to another.
```

Replace with:

```js
    const result = await cli.validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }

  /**
   * Add a data-rel edge from one existing node to another.
```

Find:

```js
  export function link(fs, args) {
```

Replace with:

```js
  export function link({ fs, args }) {
```

Find:

```js
  export async function update(fs, args, validate) {
```

Replace with:

```js
  export async function update({ fs, args, cli }) {
```

Find (still inside `update`):

```js
    const result = await validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }

  /**
   * List every node or edge in the real knowledge graph (docs/knowledge/).
```

Replace with:

```js
    const result = await cli.validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }

  /**
   * List every node or edge in the real knowledge graph (docs/knowledge/).
```

Find:

```js
  export function list(fs, args) {
```

Replace with:

```js
  export function list({ fs, args }) {
```

- [ ] **Step 5: Verify all four commands still work with the new call shape**

```bash
cd experiments/v4
pnpm mycelium knowledge list nodes | head -3
```

Expected: same kind of output as before (three tab-separated node lines) — proves `list({ fs, args })` destructuring works and `run.ts`'s new `run({ fs, args, cli })` call reaches it correctly.

```bash
pnpm mycelium knowledge --help
```

Expected: still lists all four commands with their doc comments — proves `extractCommandDocs`/`printHelp` (unaffected by this task, still reading `export async function add(...)`'s source text directly) still work.

```bash
node src/run.ts knowledge update does-not-exist.goal.html --title x 2>&1
echo "exit: $?"
```

Expected: a clean `ENOENT`-style message (not a stack trace), `exit: 1` — proves `update({ fs, args, cli })`'s destructuring doesn't break error propagation through the existing `try`/`catch`.

- [ ] **Step 6: Verify a real `add`/`link`/`update` sequence still works end to end, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "context shape test" --confidence 60 --file ctx-test)
(cd "$SCRATCH" && node "$RUN" knowledge link ctx-test.observation.html build-v4.goal.html --rel supports --label "scratch test edge")
(cd "$SCRATCH" && node "$RUN" knowledge update ctx-test.observation.html --confidence 65)
node "$VALIDATE" "$SCRATCH/docs"
rm -rf "$SCRATCH"
```

Expected: `wrote` for each of the three commands, and the final `validate` run reports `0 fail` — proves `add`, `link`, and `update` all function correctly under the new single-object call convention, not just in isolation.

- [ ] **Step 7: Verify the real repo is unaffected**

```bash
cd experiments/v4
pnpm validate
```

Expected: same count as before this task, `0 fail`.

- [ ] **Step 8: Commit**

```bash
git add experiments/v4/src/fs-helpers.ts experiments/v4/src/run.ts experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): switch command dispatch to a single destructured context object

Replaces the growing positional parameter list (fs, args, validate,
and soon a fourth) with one object, { fs, args, cli }, destructured
by whichever command needs which pieces -- add/update take cli
(validate + the new readStdin), link/list only need fs/args, same as
before. Order stops mattering and nothing has to reshuffle when a
future capability gets added. cli.readStdin is the only new shared
primitive; it drains stdin to a string and has no opinion about what
any specific flag's value means -- that stays with the command."
```

---

### Task 2: `knowledge-detail` schema — all six types, templates, validators, docs

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (all six `<template>`/`data-validates` pairs, plus the six "Fields:" prose lines)
- Modify: `CLAUDE.md` (repo root, one line in the field-table summary)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `knowledge-detail` becomes a real, `validate`-recognized, optional field on all six types. Task 3's `add`/`update` wiring and Task 4's `list` marker both depend on this landing first — a node with `<knowledge-detail>` content would fail validation as an "unexpected" tag until this task is done.

- [ ] **Step 1: `knowledge-goal`**

Find:

```
<h3><code>knowledge-goal</code></h3>
<p>What the user asked for. Fields: <code>title</code>, <code>confidence</code>, <code>status</code>,
  optional <code>prompt</code> (the verbatim request, for root goals and major direction changes).</p>
<template id="knowledge-goal">
  <knowledge-goal>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
    <knowledge-prompt></knowledge-prompt>
  </knowledge-goal>
</template>
```

Replace with:

```
<h3><code>knowledge-goal</code></h3>
<p>What the user asked for. Fields: <code>title</code>, <code>confidence</code>, <code>status</code>,
  optional <code>prompt</code> (the verbatim request, for root goals and major direction changes), optional
  <code>detail</code>.</p>
<template id="knowledge-goal">
  <knowledge-goal>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
    <knowledge-prompt></knowledge-prompt>
    <knowledge-detail></knowledge-detail>
  </knowledge-goal>
</template>
```

Find (the goal validator):

```js
    const prompt = el.querySelector('knowledge-prompt')
    if (prompt && !prompt.textContent.trim()) errors.push('<knowledge-prompt> present but empty — omit it instead')
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-prompt']
```

Replace with:

```js
    for (const tag of ['knowledge-prompt', 'knowledge-detail']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-prompt', 'knowledge-detail']
```

- [ ] **Step 2: `knowledge-decision`**

Find:

```
<h3><code>knowledge-decision</code></h3>
<p>A choice made between approaches. Fields: <code>title</code>, <code>confidence</code>,
  <code>status</code>.</p>
<template id="knowledge-decision">
  <knowledge-decision>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
  </knowledge-decision>
</template>
```

Replace with:

```
<h3><code>knowledge-decision</code></h3>
<p>A choice made between approaches. Fields: <code>title</code>, <code>confidence</code>,
  <code>status</code>, optional <code>detail</code>.</p>
<template id="knowledge-decision">
  <knowledge-decision>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
    <knowledge-detail></knowledge-detail>
  </knowledge-decision>
</template>
```

Find (the decision validator):

```js
    const status = el.querySelector('knowledge-status')?.textContent.trim()
    if (status && !['pending', 'active', 'completed', 'rejected'].includes(status)) {
      errors.push(`<knowledge-status> must be pending|active|completed|rejected, got "${status}"`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-decision`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>

<h3><code>knowledge-option</code></h3>
```

Replace with:

```js
    const status = el.querySelector('knowledge-status')?.textContent.trim()
    if (status && !['pending', 'active', 'completed', 'rejected'].includes(status)) {
      errors.push(`<knowledge-status> must be pending|active|completed|rejected, got "${status}"`)
    }
    const detail = el.querySelector('knowledge-detail')
    if (detail && !detail.textContent.trim()) errors.push('<knowledge-detail> present but empty — omit it instead')
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-detail']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-decision`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>

<h3><code>knowledge-option</code></h3>
```

- [ ] **Step 3: `knowledge-option`**

Find:

```
<h3><code>knowledge-option</code></h3>
<p>One alternative considered within a decision. No <code>status</code> &mdash; the option was or wasn't
  chosen, that's what an edge to its parent decision says, not a lifecycle of its own. Linked to its parent
  with <code>&lt;a data-rel="depends_on"&gt;</code>, the closest of the six edge labels. Fields:
  <code>title</code>, <code>confidence</code>.</p>
<template id="knowledge-option">
  <knowledge-option>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
  </knowledge-option>
</template>
```

Replace with:

```
<h3><code>knowledge-option</code></h3>
<p>One alternative considered within a decision. No <code>status</code> &mdash; the option was or wasn't
  chosen, that's what an edge to its parent decision says, not a lifecycle of its own. Linked to its parent
  with <code>&lt;a data-rel="depends_on"&gt;</code>, the closest of the six edge labels. Fields:
  <code>title</code>, <code>confidence</code>, optional <code>detail</code>.</p>
<template id="knowledge-option">
  <knowledge-option>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
  </knowledge-option>
</template>
```

Find (the option validator):

```js
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-option`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>

<h3><code>knowledge-action</code></h3>
```

Replace with:

```js
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    const detail = el.querySelector('knowledge-detail')
    if (detail && !detail.textContent.trim()) errors.push('<knowledge-detail> present but empty — omit it instead')
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-detail']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-option`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>

<h3><code>knowledge-action</code></h3>
```

- [ ] **Step 4: `knowledge-action`**

Find:

```
<h3><code>knowledge-action</code></h3>
<p>About to write or edit code. Fields: <code>title</code>, <code>confidence</code>, <code>status</code>,
  optional <code>commit</code>/<code>files</code>/<code>branch</code> once it's tied to real work.</p>
<template id="knowledge-action">
  <knowledge-action>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
    <knowledge-commit></knowledge-commit>
    <knowledge-files></knowledge-files>
    <knowledge-branch></knowledge-branch>
  </knowledge-action>
</template>
```

Replace with:

```
<h3><code>knowledge-action</code></h3>
<p>About to write or edit code. Fields: <code>title</code>, <code>confidence</code>, <code>status</code>,
  optional <code>detail</code>, optional <code>commit</code>/<code>files</code>/<code>branch</code> once
  it's tied to real work.</p>
<template id="knowledge-action">
  <knowledge-action>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
    <knowledge-detail></knowledge-detail>
    <knowledge-commit></knowledge-commit>
    <knowledge-files></knowledge-files>
    <knowledge-branch></knowledge-branch>
  </knowledge-action>
</template>
```

Find (the action validator):

```js
    for (const tag of ['knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-action`)
    }
```

Replace with:

```js
    for (const tag of ['knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-action`)
    }
```

- [ ] **Step 5: `knowledge-outcome`**

Find:

```
<h3><code>knowledge-outcome</code></h3>
<p>Something worked or failed. No <code>status</code> &mdash; an outcome is the record of what happened, not
  a thing that has a lifecycle itself. Fields: <code>title</code>, <code>confidence</code>, optional
  <code>commit</code>/<code>files</code>/<code>branch</code>.</p>
<template id="knowledge-outcome">
  <knowledge-outcome>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-commit></knowledge-commit>
    <knowledge-files></knowledge-files>
    <knowledge-branch></knowledge-branch>
  </knowledge-outcome>
</template>
```

Replace with:

```
<h3><code>knowledge-outcome</code></h3>
<p>Something worked or failed. No <code>status</code> &mdash; an outcome is the record of what happened, not
  a thing that has a lifecycle itself. Fields: <code>title</code>, <code>confidence</code>, optional
  <code>detail</code>, optional <code>commit</code>/<code>files</code>/<code>branch</code>.</p>
<template id="knowledge-outcome">
  <knowledge-outcome>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
    <knowledge-commit></knowledge-commit>
    <knowledge-files></knowledge-files>
    <knowledge-branch></knowledge-branch>
  </knowledge-outcome>
</template>
```

Find (the outcome validator):

```js
    for (const tag of ['knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-outcome`)
    }
```

Replace with:

```js
    for (const tag of ['knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-outcome`)
    }
```

- [ ] **Step 6: `knowledge-observation`**

Find:

```
<h3><code>knowledge-observation</code></h3>
<p>Something noticed along the way, not yet a decision. Fields: <code>title</code>,
  <code>confidence</code>.</p>
<template id="knowledge-observation">
  <knowledge-observation>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
  </knowledge-observation>
</template>
```

Replace with:

```
<h3><code>knowledge-observation</code></h3>
<p>Something noticed along the way, not yet a decision. Fields: <code>title</code>,
  <code>confidence</code>, optional <code>detail</code>.</p>
<template id="knowledge-observation">
  <knowledge-observation>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
  </knowledge-observation>
</template>
```

Find (the observation validator):

```js
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-observation`)
    }
```

Replace with:

```js
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    const detail = el.querySelector('knowledge-detail')
    if (detail && !detail.textContent.trim()) errors.push('<knowledge-detail> present but empty — omit it instead')
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-detail']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-observation`)
    }
```

- [ ] **Step 7: Update `CLAUDE.md`'s field-table summary**

In the repo-root `CLAUDE.md`, find:

```
every type has `title` and `confidence`; `status` (`pending`/`active`/`completed`/`rejected`) is on
`goal`/`decision`/`action` only; `commit`/`files`/`branch` are optional on `action`/`outcome` only; `prompt` is optional,
`goal` only.
```

Replace with:

```
every type has `title` and `confidence`; `status` (`pending`/`active`/`completed`/`rejected`) is on
`goal`/`decision`/`action` only; `commit`/`files`/`branch` are optional on `action`/`outcome` only; `prompt` is optional,
`goal` only; `detail` is optional on every type (free-form content, including `<script>`, no tag
restriction — see `experiments/v4/docs/specs/2026-07-24-mycelium-knowledge-detail-field.spec.html`).
```

(If the exact wrapping of this paragraph differs slightly from what's shown above when you open the file, match on the sentence containing "`commit`/`files`/`branch` are optional on `action`/`outcome` only" and append the `detail` clause to the end of that sentence — the exact line-wrap position isn't load-bearing, the content is.)

- [ ] **Step 8: Verify the schema addition doesn't change the real graph, then verify it actually works in a scratch copy**

```bash
cd experiments/v4
pnpm validate
```

Expected: same count as before this task, `0 fail` — no existing node has `<knowledge-detail>` yet, so nothing about the real graph should change.

```bash
cd /path/to/mycelium   # repo root
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cat > "$SCRATCH/docs/knowledge/detail-schema-test.observation.html" <<'EOF'
<!DOCTYPE html>
<html lang="en"><head><title>Observation: detail schema test</title></head><body>
<knowledge-observation data-conforms-to="../templates/knowledge.template.html#knowledge-observation">
<knowledge-title>schema test</knowledge-title>
<knowledge-confidence>50</knowledge-confidence>
<knowledge-detail><p>Real <b>markup</b>, not flattened.</p></knowledge-detail>
</knowledge-observation>
</body></html>
EOF
node "$VALIDATE" "$SCRATCH/docs"
rm -rf "$SCRATCH"
```

Expected: `0 fail` — a hand-built instance with real markup inside `<knowledge-detail>` passes, proving the schema addition works for all its parts (template registered, `allowed` array updated, present-but-empty check doesn't false-positive on real content since `.textContent.trim()` still finds the text inside `<p><b>markup</b></p>`).

```bash
rm -rf "$SCRATCH"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cat > "$SCRATCH/docs/knowledge/detail-empty-test.observation.html" <<'EOF'
<!DOCTYPE html>
<html lang="en"><head><title>Observation: detail empty test</title></head><body>
<knowledge-observation data-conforms-to="../templates/knowledge.template.html#knowledge-observation">
<knowledge-title>empty detail test</knowledge-title>
<knowledge-confidence>50</knowledge-confidence>
<knowledge-detail></knowledge-detail>
</knowledge-observation>
</body></html>
EOF
node "$(pwd)/experiments/v4/src/validate.ts" "$SCRATCH/docs" 2>&1 | grep -A1 "detail-empty-test"
rm -rf "$SCRATCH"
```

Expected: `unexpected <knowledge-detail> present but empty` (or similar, matching the exact message text: `<knowledge-detail> present but empty — omit it instead`) — proves the present-but-empty check fires correctly for the new field, and that a still-unknown/unrelated tag would still be rejected (closed-schema enforcement wasn't accidentally loosened for anything but `knowledge-detail`).

- [ ] **Step 9: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html CLAUDE.md
git commit -m "experiment(v4): add knowledge-detail to the schema, all six types

Optional on every type -- goal through observation -- free-form
content, no tag restriction, validated only present-and-non-empty if
present, identical treatment to how spec-design/spec-problem are
already validated. Six near-identical edits: each template gains the
element (after the short header-like fields, before commit/files/
branch where those exist), each validator's allowed array and
present-but-empty check gains knowledge-detail. Not wired into any
command yet -- add/update still don't know this field exists, that's
the next task."
```

---

### Task 3: Wire `--detail` into `add`/`update`

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (`add`/`update` only)

**Interfaces:**
- Consumes: `cli.readStdin`/`cli.validate` from Task 1's `CommandContext` shape (already wired into `add`/`update`'s signatures by Task 1 Step 4). The `knowledge-detail` schema from Task 2.
- Produces: nothing later tasks depend on directly, though Task 4's verification uses `add --detail` to create test fixtures.

- [ ] **Step 1: Wire `--detail` into `add`**

Find:

```js
  export async function add({ fs, args, cli }) {
    requireArgs([args.file, '--file'])
    const type = args._[0]
```

Replace with:

```js
  export async function add({ fs, args, cli }) {
    requireArgs([args.file, '--file'])
    const detail = args.detail === '-' ? await cli.readStdin() : args.detail
    const type = args._[0]
```

Find (still inside `add`):

```js
    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence ?? '70')
    if (REQUIRES_STATUS.includes(type)) field('knowledge-status', args.status ?? 'pending')
    if (type === 'goal') field('knowledge-prompt', args.prompt)
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)

    const result = await cli.validate(root, path)
```

Replace with:

```js
    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence ?? '70')
    if (REQUIRES_STATUS.includes(type)) field('knowledge-status', args.status ?? 'pending')
    if (type === 'goal') field('knowledge-prompt', args.prompt)
    if (detail) {
      const el = doc.createElement('knowledge-detail')
      el.innerHTML = detail
      root.appendChild(el)
    }
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)

    const result = await cli.validate(root, path)
```

Also update `add`'s doc comment. Find:

```js
  /**
   * Create a new knowledge-<type> node file.
   *
   *   mycelium run knowledge add <type> --title "…" --confidence NN --file <slug>
   *     [--status pending|active|completed|rejected] [--prompt "…"]
   *     [--commit HASH] [--files "…"] [--branch NAME]
   *
   * <type> is one of goal|decision|option|action|outcome|observation.
   * --status only applies to goal/decision/action (default "pending").
   * --prompt only applies to goal. --file is required and becomes
   * knowledge/<slug>.<type>.html. The built node is validated against
   * its own type's validator before being written — an unrecognized
   * <type>, a missing required field, or a field the type doesn't allow
   * is rejected and nothing is written.
   */
```

Replace with:

```js
  /**
   * Create a new knowledge-<type> node file.
   *
   *   mycelium run knowledge add <type> --title "…" --confidence NN --file <slug>
   *     [--status pending|active|completed|rejected] [--prompt "…"]
   *     [--detail "…" | --detail -] [--commit HASH] [--files "…"] [--branch NAME]
   *
   * <type> is one of goal|decision|option|action|outcome|observation.
   * --status only applies to goal/decision/action (default "pending").
   * --prompt only applies to goal. --file is required and becomes
   * knowledge/<slug>.<type>.html. --detail is free-form markup (real
   * HTML, including <script> — no tag restriction); pass --detail - to
   * read it from stdin instead of the command line, for anything more
   * than a one-line value. The built node is validated against its own
   * type's validator before being written — an unrecognized <type>, a
   * missing required field, or a field the type doesn't allow is
   * rejected and nothing is written.
   */
```

- [ ] **Step 2: Wire `--detail` into `update`**

Find:

```js
  export async function update({ fs, args, cli }) {
    requireArgs([args._[0], '<file>'])
    const path = `knowledge/${args._[0]}`
```

Replace with:

```js
  export async function update({ fs, args, cli }) {
    requireArgs([args._[0], '<file>'])
    const detail = args.detail === '-' ? await cli.readStdin() : args.detail
    const path = `knowledge/${args._[0]}`
```

Find (still inside `update`):

```js
    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence)
    field('knowledge-status', args.status)
    field('knowledge-prompt', args.prompt)
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)

    const result = await cli.validate(root, path)
```

Replace with:

```js
    field('knowledge-title', args.title)
    field('knowledge-confidence', args.confidence)
    field('knowledge-status', args.status)
    field('knowledge-prompt', args.prompt)
    if (detail !== undefined) {
      const existing = root.querySelector('knowledge-detail')
      if (detail === '') {
        existing?.remove()
      } else if (existing) {
        existing.innerHTML = detail
      } else {
        const el = doc.createElement('knowledge-detail')
        el.innerHTML = detail
        root.appendChild(el)
      }
    }
    field('knowledge-commit', args.commit)
    field('knowledge-files', args.files)
    field('knowledge-branch', args.branch)

    const result = await cli.validate(root, path)
```

Also update `update`'s doc comment. Find:

```js
  /**
   * Update fields on an existing knowledge-<type> node file.
   *
   *   mycelium run knowledge update <file> [--title "…"] [--confidence NN]
   *     [--status pending|active|completed|rejected] [--prompt "…"]
   *     [--commit HASH] [--files "…"] [--branch NAME]
   *
   * <file> is an existing knowledge/<slug>.<type>.html file; its type is
   * read off its own root element, not passed again. Per flag: omitted
   * leaves the field untouched, any other value upserts it (overwrite if
   * the tag is already present, append if not), and an explicit empty
   * value ("") removes the field entirely. The resulting node is
   * validated against its own type's validator before being written —
   * a disallowed field, or a required field left empty, is rejected and
   * the file on disk is left untouched.
   */
```

Replace with:

```js
  /**
   * Update fields on an existing knowledge-<type> node file.
   *
   *   mycelium run knowledge update <file> [--title "…"] [--confidence NN]
   *     [--status pending|active|completed|rejected] [--prompt "…"]
   *     [--detail "…" | --detail - | --detail ""] [--commit HASH]
   *     [--files "…"] [--branch NAME]
   *
   * <file> is an existing knowledge/<slug>.<type>.html file; its type is
   * read off its own root element, not passed again. Per flag: omitted
   * leaves the field untouched, any other value upserts it (overwrite if
   * the tag is already present, append if not), and an explicit empty
   * value ("") removes the field entirely. --detail follows the same
   * rule, but is free-form markup rather than plain text — pass
   * --detail - to read it from stdin. The resulting node is validated
   * against its own type's validator before being written — a
   * disallowed field, or a required field left empty, is rejected and
   * the file on disk is left untouched.
   */
```

- [ ] **Step 3: Verify a literal `--detail` value works, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "literal detail test" --confidence 60 --file literal-test --detail "<p>Some <b>real</b> markup.</p>")
grep "knowledge-detail" "$SCRATCH/docs/knowledge/literal-test.observation.html"
node "$VALIDATE" "$SCRATCH/docs"
```

Expected: `wrote    knowledge/literal-test.observation.html`; the `grep` shows `<knowledge-detail><p>Some <b>real</b> markup.</p></knowledge-detail>` — real markup, not HTML-escaped (`&lt;p&gt;`) the way `.textContent` would have produced; `0 fail`.

- [ ] **Step 4: Verify `--detail -` reads from stdin, in the same scratch copy**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "stdin detail test" --confidence 60 --file stdin-test --detail - <<'EOF'
<h2>From stdin</h2>
<p>Multiple paragraphs, no shell escaping needed at all.</p>
<pre><code>const example = "even this survives untouched"</code></pre>
EOF
)
grep -c "knowledge-detail\|From stdin\|even this survives" "$SCRATCH/docs/knowledge/stdin-test.observation.html"
node "$(pwd)/experiments/v4/src/validate.ts" "$SCRATCH/docs" 2>&1 | tail -3
```

Expected: `wrote    knowledge/stdin-test.observation.html`; the `grep -c` count matches 3 (all three fragments found); `0 fail`. This is the concrete proof of the whole feature's original motivation: a multi-paragraph, code-block-containing value authored in one command with zero shell-quoting concerns.

- [ ] **Step 5: Verify `update` upserts `--detail` on an existing node**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge update literal-test.observation.html --detail "<p>Replaced content.</p>")
grep "Replaced content" "$SCRATCH/docs/knowledge/literal-test.observation.html"
grep -c "Some.*real.*markup" "$SCRATCH/docs/knowledge/literal-test.observation.html"
```

Expected: `wrote`; the first `grep` finds "Replaced content"; the second `grep -c` reports `0` (the old content is gone — this was an overwrite, not an append, since `existing` was found and `.innerHTML` was reassigned).

- [ ] **Step 6: Verify `update --detail ""` removes the field**

```bash
(cd "$SCRATCH" && node "$RUN" knowledge update literal-test.observation.html --detail "")
grep -c "knowledge-detail" "$SCRATCH/docs/knowledge/literal-test.observation.html"
node "$(pwd)/experiments/v4/src/validate.ts" "$SCRATCH/docs" 2>&1 | tail -3
```

Expected: `wrote`; `grep -c` reports `0` (no `<knowledge-detail>` tag remains at all, not even empty); `0 fail`.

- [ ] **Step 7: Clean up, verify the real repo still passes**

```bash
rm -rf "$SCRATCH"
cd experiments/v4
pnpm validate
```

Expected: same count as before this task, `0 fail`.

- [ ] **Step 8: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): wire --detail into add and update

Literal values are used as-is; the exact string - reads from stdin
via cli.readStdin instead, so multi-paragraph markup with code blocks
never has to survive shell quoting. Inserted via innerHTML, not the
existing textContent-based field() helper -- that distinction is the
whole point, since textContent would silently flatten real markup
back down to escaped text. update follows its existing upsert/remove
convention: omitted leaves it alone, empty string removes it,
anything else replaces it."
```

---

### Task 4: `list nodes` gets a `[+detail]` marker

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (`list` only)

**Interfaces:**
- Consumes: nothing from other tasks directly, but verification uses `add --detail` (Task 3) to build fixtures with real detail content to check the marker against.
- Produces: nothing later tasks consume — this is the last task.

- [ ] **Step 1: Add the marker column to `list`**

Find:

```js
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
```

Replace with:

```js
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
        const hasDetail = !!el.querySelector(`${family}-detail`)?.textContent.trim()
        console.log(`${path}\t${type}\t${status}\t${title}\t${hasDetail ? '[+detail]' : ''}`)
      }
      return
    }
```

Also update `list`'s doc comment. Find:

```js
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
```

Replace with:

```js
  /**
   * List every node or edge in the real knowledge graph (docs/knowledge/).
   *
   *   mycelium run knowledge list nodes [--status S] [--type T]
   *   mycelium run knowledge list edges
   *
   * nodes: one line per file — path, type (read off the root element's
   * own tag name), status (blank if the type has none), title, and a
   * [+detail] marker (blank if the node has no non-empty knowledge-detail).
   * --status and --type optionally filter which nodes print; --type
   * matches the bare type (e.g. "goal", not "knowledge-goal"), the same
   * form `add <type>` takes.
   * edges: one line per <a data-rel> found — source file, rel, href,
   * label text.
   */
```

- [ ] **Step 2: Verify the marker appears only for nodes with real detail content, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "has detail" --confidence 60 --file has-detail-test --detail "<p>content</p>")
(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "no detail" --confidence 60 --file no-detail-test)

(cd "$SCRATCH" && node "$RUN" knowledge list nodes) | grep "has-detail-test\|no-detail-test"
```

Expected: the `has-detail-test` line ends with `[+detail]` in its fifth column; the `no-detail-test` line's fifth column is empty. Confirm precisely with `awk`:

```bash
(cd "$SCRATCH" && node "$RUN" knowledge list nodes) | awk -F'\t' '/has-detail-test/ { print ($5 == "[+detail]") ? "PASS" : "FAIL: " $0 }'
(cd "$SCRATCH" && node "$RUN" knowledge list nodes) | awk -F'\t' '/no-detail-test/ { print ($5 == "") ? "PASS" : "FAIL: " $0 }'
```

Expected: both print `PASS`.

- [ ] **Step 3: Verify an explicitly-empty `<knowledge-detail>` does not count as "has detail"**

(This shouldn't be reachable through `add`/`update` per Task 3's design — `update --detail ""` removes the tag entirely rather than leaving it empty — but `list`'s own check should be correct regardless of how such a file came to exist, e.g. hand-edited or from an older version of a document.)

```bash
cat > "$SCRATCH/docs/knowledge/empty-detail-tag-test.observation.html" <<'EOF'
<!DOCTYPE html>
<html lang="en"><head><title>Observation: empty detail tag test</title></head><body>
<knowledge-observation data-conforms-to="../templates/knowledge.template.html#knowledge-observation">
<knowledge-title>empty detail tag test</knowledge-title>
<knowledge-confidence>50</knowledge-confidence>
<knowledge-detail>   </knowledge-detail>
</knowledge-observation>
</body></html>
EOF
(cd "$SCRATCH" && node "$RUN" knowledge list nodes) | awk -F'\t' '/empty-detail-tag-test/ { print ($5 == "") ? "PASS" : "FAIL: " $0 }'
```

Expected: `PASS` — whitespace-only content doesn't count as "has detail" (matches `.textContent.trim()`'s truthiness check, same as the validator's own present-but-empty logic).

- [ ] **Step 4: Clean up, verify the real repo's `list nodes` output is well-formed**

```bash
rm -rf "$SCRATCH"
cd experiments/v4
pnpm mycelium knowledge list nodes | awk -F'\t' '{ if (NF < 5) print "FAIL (wrong column count): " $0 }'
```

Expected: no output — every real node's line has exactly 5 tab-separated fields (the trailing empty marker column still counts as a field, since `console.log` always emits the `${hasDetail ? '[+detail]' : ''}` interpolation).

```bash
pnpm validate
```

Expected: same count as before this task, `0 fail`.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): list nodes gets a [+detail] marker column

Fifth tab-separated column, always present so the output stays a
fixed-width, awk-friendly shape: [+detail] when the node's
knowledge-detail is present and has real (non-whitespace) content,
empty otherwise."
```

---

## Self-Review Notes

- **Spec coverage:** "The field: knowledge-detail, optional on all six types" + "Every validator's allowed array" → Task 2. "Insertion mechanism... needs its own insertion path" → Task 3 (`.innerHTML =`, not `field()`'s `.textContent =`). "Script tags are a feature" → Task 2's content model (no allowlist added) + Task 3 (no special-casing of `<script>` content anywhere). "CLI: one flag, an exact-match sentinel for stdin" → Task 3. "Shared input-resolution helper" → superseded during plan-writing by the `cli.readStdin` + inline-ternary design (Task 1 + Task 3); the *reusability* goal the spec named (spec.template.html's future commands get it for free) is actually strengthened by this change, since `cli` is assembled once by the generic engine rather than per-family. "list nodes gets a marker" → Task 4. Both `<spec-out-of-scope>` items and the plan's own Global Constraints agree: no tag allowlist, no `data-conforms-to`-collision guard, no `javascript:`-URI check, no `runtime.js` change, no `spec.template.html` command script — none of these appear as tasks, correctly.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable. One intentionally-illustrative non-command line in Task 2 Step 8 is explicitly marked "ignore it" rather than left ambiguous.
- **Type consistency:** `Cli`/`CommandContext` (Task 1) are used identically at every later call site — `add`/`update` destructure `{ fs, args, cli }` (Task 1 Step 4, unchanged through Tasks 2-3), `link`/`list` destructure `{ fs, args }` only. `cli.readStdin` (Task 1) is called exactly as declared (`() => Promise<string>`, no arguments) at both its Task 3 call sites. The `detail` variable's three-state contract (`undefined`/`''`/real value) established in Task 3 is handled identically in both `add` and `update`, matching each command's pre-existing `field()` convention for every other optional field.
- **Ordering:** Task 1 must land before Tasks 2-4 (all of them touch code that assumes the new `{ fs, args, cli }` shape already exists, or in Task 2's case, is orthogonal but shares the same file). Task 2 must land before Task 3 (an `add --detail` call would fail validation with "unexpected `<knowledge-detail>`" if the schema doesn't allow it yet). Task 3 must land before Task 4's verification can create real fixtures with detail content (though Task 4's own code change doesn't strictly depend on Task 3). This is a strictly sequential plan, not a parallelizable one — every task after the first touches the same file as its predecessor.
