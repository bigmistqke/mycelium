# plan.template.html Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `plan-*` template family (`docs/templates/plan.template.html`) to v4's docs/ knowledge system — a `plan-doc` containing `plan-task`s containing `plan-step`s, each step optionally carrying a runnable `plan-check` — the same override of `superpowers:writing-plans`' Markdown output that `spec.template.html` already made for `superpowers:brainstorming`.

**Architecture:** Four nested conforming types share one template file (`plan-doc` > `plan-task` > `plan-step` > `plan-check`), each independently validated via its own `<template>` + `data-conforms-to`, following the exact pattern `knowledge.template.html`/`spec.template.html` already established. Four CLI commands (`add`, `update`, `check`, `list`) live in one `<script type="mycelium/command">` block; `add`/`update` dispatch on a `doc|task|step` kind argument, mirroring `knowledge add <type>`'s existing convention. `check` shells out via `node:child_process` — the first command in this project to do so.

**Tech Stack:** TypeScript run directly via Node (no build step), happy-dom for DOM parsing, acorn for JSDoc extraction (all pre-existing — no new dependencies).

## Global Constraints

- Every new tag is hyphenated (`plan-doc`, not `plandoc`) — required for Custom Elements API safety and to guarantee no collision with any current or future standard HTML element, per the convention every existing family already follows.
- Fields share only the family prefix, not the full type name (`plan-title`, not `plan-doc-title`) — established in `spec.template.html`'s own naming section, reused verbatim here.
- No unit test framework exists anywhere in this repo (confirmed: no `*.test.ts`/`*.spec.ts` files, no test runner in `package.json`). Verification throughout this plan is `pnpm validate` (the real schema/audit crawler) plus manually invoking each new command via `pnpm mycelium plan ...` and inspecting the result — the same verification method every existing template/command file in this repo was built with.
- `pnpm --filter @mycelium/v4 mycelium ...` works from the repo root; `pnpm mycelium ...` / `pnpm validate` work from inside `experiments/v4/`. All commands below assume the working directory is `experiments/v4/`.
- This project's `require-action-node.sh` hook blocks any Edit/Write tool call unless a `knowledge/*.goal.html` or `*.action.html` file has been touched in the last 15 minutes. Before starting each task below, run `pnpm mycelium knowledge add action --title "…" --confidence NN --file <slug>` (and link it to the parent goal `2026-07-25-plan-template-html-exploration.goal.html` via `pnpm mycelium knowledge link <new-action-file> 2026-07-25-plan-template-html-exploration.goal.html --rel depends_on --href ./2026-07-25-plan-template-html-exploration.goal.html --label "…"`) if more than ~15 minutes have passed since the last one. After each task's commit, update that action node with `--commit <hash> --branch main`.
- CLI flags with hyphens (`--tech-stack`, `--check-command`, `--expected-success`, `--expected-output`) are read in code via bracket notation (`args["tech-stack"]`), never dot notation (`args.techStack`) — `run.ts`'s `parseArgs` stores the raw flag name verbatim as the object key, with no camelCase conversion.

---

## File Structure

- **Modify:** `experiments/v4/docs/templates/template.template.html` — fix `validateFromTemplate`'s field lookup to scope to direct children only (Task 1). Shared infrastructure; used by every family.
- **Create:** `experiments/v4/docs/templates/plan.template.html` — the four `<template>` schema definitions, docs prose, live-demo, and the `<script type="mycelium/command">` block holding `add`/`update`/`check`/`list` (Tasks 2–7).
- **Create:** `experiments/v4/docs/templates/plan.template.css` — this family's rendering rules (Task 2).
- **Create (directory):** `experiments/v4/docs/plans/` — bootstrapped in Task 3, holds every `*.plan.html` file `add doc` produces.

## Interfaces produced across tasks (for later tasks' own reference)

- Task 1 produces: `validateFromTemplate(templateEl, instanceEl) => {ok: boolean, errors: string[]}` in `template.template.html`, now scoped to direct children. Every later task's `cli.validate()` call relies on this being correct.
- Task 3 produces, in `plan.template.html`'s own `<script type="mycelium/command">` block: `requireArgs(...checks)`, `directChild(root, tag) => Element|undefined`, `field(doc, root, tag, text) => void`, `nextId(root, tag, prefix) => string`, plus `export async function add({fs, args, cli})` and `export async function update({fs, args, cli})` (each dispatching on `args._[0]`). Tasks 4–5 extend these same two exports with more `kind` branches; they do not create new exports.
- Task 5 produces: `buildCheck(doc, checkCommand, expectedSuccess, expectedOutput) => Element` (a `<plan-check>` element, not yet attached to a parent). Task 6's `check` command reads the same `plan-check-command`/`plan-check-success`/`plan-check-output` shape this builds.

---

### Task 1: Fix direct-child field scoping in the shared validator

**Files:**
- Modify: `experiments/v4/docs/templates/template.template.html:89` (inside the exported `validateFromTemplate` function)

**Interfaces:**
- Produces: `validateFromTemplate(templateEl: Element, instanceRoot: Element) => {ok: boolean, errors: string[]}` — same signature as before, corrected behavior only.

- [ ] **Step 1: Write a failing reproducer script**

This bug has no existing regression test to build on (no test framework exists in this repo), so write a throwaway Node script that exercises the exact failure mode: a required field on a parent that's genuinely absent, but present on a nested same-named child — today's deep `querySelector` incorrectly matches the child's field and reports the parent as valid.

Create `/private/tmp/claude-501/-Users-bigmistqke-Documents-GitHub-mycelium/ea8989df-efdc-46ed-b814-5c9f5f4df4e0/scratchpad/nested-field-scoping-repro.mjs`:

```js
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import { Window } from "happy-dom"

const V4_ROOT = "/Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4"

register(pathToFileURL(`${V4_ROOT}/src/script-hooks.ts`).href)

const { validateFromTemplate } = await import(
  `${pathToFileURL(`${V4_ROOT}/docs/templates/template.template.html`).href}#validate-from-template`
)

const window = new Window()
window.document.write(`
  <template id="foo-parent">
    <foo-parent><foo-title required></foo-title></foo-parent>
  </template>
  <foo-parent id="instance">
    <foo-child><foo-title>nested title, not the parent's own</foo-title></foo-child>
  </foo-parent>
`)
const doc = window.document
const templateEl = doc.querySelector("template#foo-parent")
const instance = doc.querySelector("#instance")

const result = validateFromTemplate(templateEl, instance)

if (result.ok) {
  console.error(`FAIL: expected result.ok === false (the parent's own required <foo-title> is genuinely missing), got ok === true — validateFromTemplate matched the nested <foo-child>'s <foo-title> instead of scoping to direct children. errors: ${JSON.stringify(result.errors)}`)
  process.exit(1)
}
if (!result.errors.includes("missing or empty <foo-title>")) {
  console.error(`FAIL: expected error "missing or empty <foo-title>", got: ${JSON.stringify(result.errors)}`)
  process.exit(1)
}
console.log("PASS")
process.exit(0)
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `node /private/tmp/claude-501/-Users-bigmistqke-Documents-GitHub-mycelium/ea8989df-efdc-46ed-b814-5c9f5f4df4e0/scratchpad/nested-field-scoping-repro.mjs`

Expected: `FAIL: expected result.ok === false ... got ok === true ...` and exit code 1 — this demonstrates the bug exists (deep `querySelector` inside `validateFromTemplate` wrongly matches the nested child's `<foo-title>`).

- [ ] **Step 3: Apply the fix**

In `experiments/v4/docs/templates/template.template.html`, inside the `<script type="module" id="validate-from-template">` block's `validateFromTemplate` function, change line 89 from a deep `querySelector` to a direct-children-only lookup, matching the style the "unexpected field" check two loops below it already uses:

```js
      const node = el.querySelector(tag)
```

becomes:

```js
      const node = Array.from(el.children).find((c) => c.tagName.toLowerCase() === tag)
```

- [ ] **Step 4: Run the reproducer again, confirm it passes**

Run: `node /private/tmp/claude-501/-Users-bigmistqke-Documents-GitHub-mycelium/ea8989df-efdc-46ed-b814-5c9f5f4df4e0/scratchpad/nested-field-scoping-repro.mjs`

Expected: `PASS` and exit code 0.

- [ ] **Step 5: Confirm no regression across the existing corpus**

Run: `pnpm validate` (from `experiments/v4/`)

Expected: `138 checked, 0 fail` (or however many nodes currently exist — the count must match what it was before this change; the fix is a no-op for every existing single-level instance, since a direct-children scan and a subtree scan return the same first match whenever there's no nested same-tag element).

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/docs/templates/template.template.html
git commit -m "v4: scope validateFromTemplate's field lookup to direct children

Required/pattern/enum checks used a deep querySelector, unlike the
unexpected-field check two loops below which already correctly scoped
to direct children only. Never mattered before -- no existing
knowledge-* or spec-doc instance nests a same-named field inside
itself. plan-doc/plan-task/plan-step (built next) all share
plan-title/plan-status across three nesting levels, so this needed
fixing first: without it, checking a plan-task's own plan-title could
silently match a nested plan-step's title instead, depending on
markup order."
```

Then update the task's own knowledge-action node with this commit hash.

---

### Task 2: plan.template.html schema, CSS, and live-demo

**Files:**
- Create: `experiments/v4/docs/templates/plan.template.html`
- Create: `experiments/v4/docs/templates/plan.template.css`

**Interfaces:**
- Consumes: `validateFromTemplate` (Task 1) — exercised indirectly via `pnpm validate`'s crawl of this file's own live-demo sample instances, not imported directly by this task.
- Produces: four `<template id="plan-doc|plan-task|plan-step|plan-check">` schema definitions other tasks' `cli.validate()` calls resolve against.

- [ ] **Step 1: Write plan.template.css**

Create `experiments/v4/docs/templates/plan.template.css`:

```css
/* The plan-* field vocabulary: four nested conforming types (doc, task,
   step, check) sharing plan-title/plan-status where they overlap. Every
   tag is hyphenated so it can never collide with a current or future
   standard HTML element. Selectors stay scoped under each root type so
   this file's rules can never leak onto another template's same-named
   field tags (see spec.template.css). */
plan-doc, plan-task, plan-step, plan-check {
  display: block;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 1.25rem 1.5rem;
  background: var(--code-bg);
  margin: 1.25rem 0;
}
plan-task, plan-step, plan-check { margin-left: 1.5rem; }
plan-doc > plan-title, plan-task > plan-title, plan-step > plan-title {
  display: block;
  font-weight: 700;
  font-size: 1.3rem;
  margin-bottom: 0.5rem;
}
plan-doc > plan-status, plan-task > plan-status, plan-step > plan-status, plan-doc > plan-date {
  display: inline-block;
  margin-right: 1rem;
  color: var(--muted);
  font-size: 0.9rem;
}
plan-doc > plan-status::before, plan-task > plan-status::before, plan-step > plan-status::before { content: "status: "; }
plan-doc > plan-date::before { content: "date: "; }
plan-doc > plan-goal, plan-doc > plan-architecture, plan-doc > plan-tech-stack, plan-doc > plan-global-constraints,
plan-task > plan-files, plan-task > plan-interfaces, plan-step > plan-detail {
  display: block;
  margin-top: 0.75rem;
}
plan-check > plan-check-command {
  display: block;
  font-family: monospace;
  margin-top: 0.5rem;
}
plan-check > plan-check-success, plan-check > plan-check-output {
  display: block;
  color: var(--muted);
  font-size: 0.9rem;
  margin-top: 0.35rem;
}
plan-check > plan-check-success::before { content: "expect success: "; }
plan-check > plan-check-output::before { content: "expect output contains: "; }
```

- [ ] **Step 2: Write plan.template.html's head, header prose, and schema definitions**

Create `experiments/v4/docs/templates/plan.template.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Templates: plan-*</title>
<link rel="stylesheet" href="../theme.css">
<link rel="stylesheet" href="./plan.template.css">
</head>
<body>

<h1>Templates: plan-*</h1>
<div class="meta">
  <div><b>Node types:</b> <code>plan-doc</code>, <code>plan-task</code>, <code>plan-step</code>,
    <code>plan-check</code> &mdash; four templates, one file, nested three deep, per the family-file
    convention</div>
  <div><b>File naming:</b> this file is <code>plan.template.html</code>, named after the <code>plan-*</code>
    family it defines. Documents that conform to <code>plan-doc</code> are named
    <code>&lt;date&gt;-&lt;topic&gt;.plan.html</code></div>
  <div><b>Purpose:</b> the shape an implementation plan takes when written as a v4 node instead of the
    <code>superpowers:writing-plans</code> skill's default Markdown &mdash; the same override
    <code>spec.template.html</code> already made for <code>superpowers:brainstorming</code>'s spec output</div>
  <div><b>Sibling of:</b> <code>knowledge.template.html</code>, <code>spec.template.html</code></div>
  <div><b>Styling:</b> <code>./plan.template.css</code>, this family's own rendering rules, plus the shared
    <code>../theme.css</code> every document links</div>
</div>

<h2>Four nested conforming types, not one flat schema</h2>
<p>
  <code>plan-doc</code> contains <code>plan-task</code>s, each independently conforming to
  <code>#plan-task</code>; <code>plan-task</code> contains <code>plan-step</code>s, each conforming to
  <code>#plan-step</code>; <code>plan-step</code> contains at most one <code>plan-check</code>, conforming to
  <code>#plan-check</code>. This is the same pattern <a href="./spec.template.html">spec.template.html</a>'s
  own "Conformance" section documents: a document can have any number of typed elements nested inside it,
  each independently addressable via its own <code>data-conforms-to</code>. A parent's own
  <code>&lt;template&gt;</code> only ever declares a nested child tag as "may be present" &mdash; it can't
  reach into that child's own internal shape, which is why each of the three nested types needs its own
  <code>data-conforms-to</code>: <code>pnpm validate</code>'s crawler finds every validatable instance purely
  by scanning for <code>[data-conforms-to]</code> anywhere in the tree.
</p>
<p>
  <code>plan-title</code>/<code>plan-status</code> repeat across all three nesting levels (doc, task, step)
  &mdash; fields belong to the family, not to one type within it, same as every other family here. This is
  exactly the scenario that required fixing <code>template.template.html</code>'s generic validator to scope
  its field lookups to direct children only, rather than searching an instance's entire subtree.
</p>

<h2>The four types</h2>

<h3><code>plan-doc</code></h3>
<p>Fields: <code>title</code>, <code>status</code>, <code>date</code>, <code>goal</code>,
  <code>architecture</code>, optional <code>tech-stack</code>, optional <code>global-constraints</code>,
  optional (repeatable) <code>plan-task</code> children.</p>
<template id="plan-doc">
  <plan-doc>
    <plan-title required></plan-title>
    <plan-status required enum="pending active completed rejected"></plan-status>
    <plan-date required></plan-date>
    <plan-goal required></plan-goal>
    <plan-architecture required></plan-architecture>
    <plan-tech-stack></plan-tech-stack>
    <plan-global-constraints></plan-global-constraints>
    <plan-task></plan-task>
  </plan-doc>
</template>
<pre><code>&lt;plan-doc data-conforms-to="./plan.template.html#plan-doc"&gt;
  &lt;plan-title&gt;&hellip;&lt;/plan-title&gt;
  &lt;plan-status&gt;active&lt;/plan-status&gt;
  &lt;plan-date&gt;2026-07-25&lt;/plan-date&gt;
  &lt;plan-goal&gt;&hellip;&lt;/plan-goal&gt;
  &lt;plan-architecture&gt;&hellip;&lt;/plan-architecture&gt;
&lt;/plan-doc&gt;</code></pre>

<h3><code>plan-task</code></h3>
<p>Fields: <code>title</code>, <code>status</code>, <code>files</code>, optional <code>interfaces</code>,
  optional (repeatable) <code>plan-step</code> children.</p>
<template id="plan-task">
  <plan-task>
    <plan-title required></plan-title>
    <plan-status required enum="pending active completed rejected"></plan-status>
    <plan-files required></plan-files>
    <plan-interfaces></plan-interfaces>
    <plan-step></plan-step>
  </plan-task>
</template>
<pre><code>&lt;plan-task id="task-1" data-conforms-to="./plan.template.html#plan-task"&gt;
  &lt;plan-title&gt;&hellip;&lt;/plan-title&gt;
  &lt;plan-status&gt;pending&lt;/plan-status&gt;
  &lt;plan-files&gt;Create: &hellip;&lt;/plan-files&gt;
&lt;/plan-task&gt;</code></pre>

<h3><code>plan-step</code></h3>
<p>Fields: <code>title</code>, <code>status</code> (narrower enum than doc/task &mdash; a single step is only
  ever done or not), optional <code>detail</code>, optional <code>plan-check</code> child.</p>
<template id="plan-step">
  <plan-step>
    <plan-title required></plan-title>
    <plan-status required enum="pending completed"></plan-status>
    <plan-detail></plan-detail>
    <plan-check></plan-check>
  </plan-step>
</template>
<pre><code>&lt;plan-step id="task-1-step-1" data-conforms-to="./plan.template.html#plan-step"&gt;
  &lt;plan-title&gt;Write the failing test&lt;/plan-title&gt;
  &lt;plan-status&gt;pending&lt;/plan-status&gt;
&lt;/plan-step&gt;</code></pre>

<h3><code>plan-check</code></h3>
<p>Fields: <code>command</code>, optional <code>success</code> (enum <code>true|false</code>, code default
  <code>"true"</code> when absent), optional <code>output</code> (a plain substring match).</p>
<template id="plan-check">
  <plan-check>
    <plan-check-command required></plan-check-command>
    <plan-check-success enum="true false"></plan-check-success>
    <plan-check-output></plan-check-output>
  </plan-check>
</template>
<pre><code>&lt;plan-check data-conforms-to="./plan.template.html#plan-check"&gt;
  &lt;plan-check-command&gt;pytest tests/foo.py::test_bar -v&lt;/plan-check-command&gt;
  &lt;plan-check-success&gt;false&lt;/plan-check-success&gt;
  &lt;plan-check-output&gt;function not defined&lt;/plan-check-output&gt;
&lt;/plan-check&gt;</code></pre>

<div class="live-demo">
  <h4>This section actually runs</h4>
  <p>
    One realistic nested instance (a doc containing a task containing a step containing a check), checked by
    a locally-defined direct-children-scoped validator &mdash; duplicated rather than imported, the same way
    <code>knowledge.template.html</code>'s own live-demo validator duplicates rather than imports (a
    browser-loaded module has no reliable way to import across files over <code>file://</code>). The real
    authoritative check is <code>pnpm validate</code>, which does use the real shared
    <code>validateFromTemplate</code> under Node.
  </p>

  <div id="sample-instances" style="display:none">
    <plan-doc id="sample-doc" data-conforms-to="./plan.template.html#plan-doc">
      <plan-title>Sample plan</plan-title>
      <plan-status>active</plan-status>
      <plan-date>2026-07-25</plan-date>
      <plan-goal>Build the thing.</plan-goal>
      <plan-architecture>Do it in a few small steps.</plan-architecture>
      <plan-task id="sample-task" data-conforms-to="./plan.template.html#plan-task">
        <plan-title>Sample task</plan-title>
        <plan-status>active</plan-status>
        <plan-files>Create: src/thing.ts</plan-files>
        <plan-step id="sample-step" data-conforms-to="./plan.template.html#plan-step">
          <plan-title>Sample step</plan-title>
          <plan-status>pending</plan-status>
          <plan-check id="sample-check" data-conforms-to="./plan.template.html#plan-check">
            <plan-check-command>echo ok</plan-check-command>
            <plan-check-success>true</plan-check-success>
          </plan-check>
        </plan-step>
      </plan-task>
    </plan-doc>
  </div>

  <pre id="validator-output">running&hellip;</pre>

  <script type="module">
    function directChild(root, tag) {
      return Array.from(root.children).find((c) => c.tagName.toLowerCase() === tag)
    }

    function checkGeneric(el, required, enums) {
      const errors = []
      for (const f of required) {
        const node = directChild(el, f)
        if (!node || !node.textContent.trim()) errors.push(`missing or empty <${f}>`)
      }
      for (const [f, values] of Object.entries(enums)) {
        const node = directChild(el, f)
        const text = node?.textContent.trim()
        if (text && !values.includes(text)) errors.push(`<${f}> must be ${values.join('|')}, got "${text}"`)
      }
      return { ok: errors.length === 0, errors }
    }

    const specs = [
      ['plan-doc', 'sample-doc', ['plan-title', 'plan-status', 'plan-date', 'plan-goal', 'plan-architecture'], { 'plan-status': ['pending', 'active', 'completed', 'rejected'] }],
      ['plan-task', 'sample-task', ['plan-title', 'plan-status', 'plan-files'], { 'plan-status': ['pending', 'active', 'completed', 'rejected'] }],
      ['plan-step', 'sample-step', ['plan-title', 'plan-status'], { 'plan-status': ['pending', 'completed'] }],
      ['plan-check', 'sample-check', ['plan-check-command'], { 'plan-check-success': ['true', 'false'] }],
    ]

    const container = document.getElementById('sample-instances')
    const lines = specs.map(([tag, id, required, enums]) => {
      const el = container.querySelector(`#${id}`)
      const result = checkGeneric(el, required, enums)
      return result.ok ? `PASS  <${tag}>` : `FAIL  <${tag}>: ${result.errors.join('; ')}`
    })
    const out = document.getElementById('validator-output')
    out.textContent = lines.join('\n')
    out.className = lines.every((l) => l.startsWith('PASS')) ? 'pass' : 'fail'
  </script>
</div>

</body>
</html>
```

- [ ] **Step 3: Confirm the sample instances validate for real**

Run: `pnpm validate` (from `experiments/v4/`)

Expected: `142 checked, 0 fail` (138 from before Task 1/2, plus the 4 new sample instances — `plan-doc`, `plan-task`, `plan-step`, `plan-check` — all passing).

If any fail, the error message names the exact tag/field — check the sample instance's markup against the `<template>` definition it claims to conform to.

- [ ] **Step 4: Commit**

```bash
git add experiments/v4/docs/templates/plan.template.html experiments/v4/docs/templates/plan.template.css
git commit -m "v4: add plan.template.html schema (plan-doc/task/step/check)

Four nested conforming types sharing one file, each independently
validated via its own <template>/data-conforms-to -- plan-doc contains
plan-tasks, plan-task contains plan-steps, plan-step contains at most
one plan-check. No CLI commands yet; this is schema plus a live-demo
only, verified via pnpm validate against four sample instances."
```

Then update the task's own knowledge-action node with this commit hash.

---

### Task 3: `add doc` / `update doc` commands

**Files:**
- Modify: `experiments/v4/docs/templates/plan.template.html` (append a `<script type="mycelium/command">` block before `</body>`)

**Interfaces:**
- Consumes: the four `<template>` definitions (Task 2).
- Produces: `requireArgs`, `directChild`, `field`, `nextId` helpers; `export async function add({fs, args, cli})` and `export async function update({fs, args, cli})`, each currently only handling `kind === "doc"`.

- [ ] **Step 1: Create the docs/plans/ directory**

Run: `mkdir -p experiments/v4/docs/plans` (from the repo root, or `mkdir -p docs/plans` from `experiments/v4/`)

`fs.create()`/`fs.commit()` write via plain `writeFileSync`, which doesn't create missing parent directories — every other family's own directory (`docs/knowledge/`, `docs/specs/`) already exists on disk for the same reason.

- [ ] **Step 2: Add the command script with add/update (doc kind only)**

Insert this block into `experiments/v4/docs/templates/plan.template.html`, right before `</body>`:

```html
<h2>Authoring commands</h2>
<p>
  <code>add</code> and <code>update</code> each take a <em>kind</em> (<code>doc</code>, <code>task</code>, or
  <code>step</code>) as their own first positional argument and dispatch internally &mdash; the same
  convention <code>knowledge add &lt;type&gt;</code> already established, reused here instead of four
  separate hyphenated command names, which JavaScript can't export as plain identifiers.
</p>
<script type="mycelium/command">
  import { todayDate } from "./shared.ts"

  function requireArgs(...checks) {
    for (const [value, label] of checks) {
      if (value === undefined) throw new Error(`missing required argument: ${label}`)
    }
  }

  function directChild(root, tag) {
    return Array.from(root.children).find((c) => c.tagName.toLowerCase() === tag)
  }

  function field(doc, root, tag, text) {
    if (text === undefined) return
    const existing = directChild(root, tag)
    if (text === "") {
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

  function nextId(root, tag, prefix) {
    const count = Array.from(root.children).filter((c) => c.tagName.toLowerCase() === tag).length
    return `${prefix}-${count + 1}`
  }

  async function addDoc({ fs, args, cli }) {
    requireArgs([args.file, "--file"], [args.goal, "--goal"], [args.architecture, "--architecture"])
    const date = todayDate()
    const path = `plans/${date}-${args.file}.plan.html`
    const doc = fs.create(path, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<link rel="stylesheet" href="../theme.css">
<link rel="stylesheet" href="../templates/plan.template.css">
</head>
<body>

<plan-doc data-conforms-to="../templates/plan.template.html#plan-doc">
</plan-doc>

</body>
</html>
`)

    doc.querySelector("title").textContent = `Plan: ${args.title}`

    const root = doc.querySelector("plan-doc")
    field(doc, root, "plan-title", args.title)
    field(doc, root, "plan-status", args.status ?? "pending")
    field(doc, root, "plan-date", date)
    field(doc, root, "plan-goal", args.goal)
    field(doc, root, "plan-architecture", args.architecture)
    field(doc, root, "plan-tech-stack", args["tech-stack"])
    field(doc, root, "plan-global-constraints", args["global-constraints"])

    const result = await cli.validate(root, path)
    if (!result.ok) throw new Error(result.errors.join("\n"))
  }

  async function updateDoc({ fs, args, cli }) {
    requireArgs([args._[1], "<file>"])
    const path = `plans/${args._[1]}`
    const doc = fs.get(path)
    const root = doc.querySelector("plan-doc")
    if (!root) throw new Error(`${args._[1]} has no <plan-doc> root`)

    field(doc, root, "plan-title", args.title)
    field(doc, root, "plan-status", args.status)
    field(doc, root, "plan-goal", args.goal)
    field(doc, root, "plan-architecture", args.architecture)
    field(doc, root, "plan-tech-stack", args["tech-stack"])
    field(doc, root, "plan-global-constraints", args["global-constraints"])

    const result = await cli.validate(root, path)
    if (!result.ok) throw new Error(result.errors.join("\n"))
  }

  /**
   * Create a new plan-doc.
   *
   *   mycelium run plan add doc --title "…" --file <topic> --goal "…"
   *     --architecture "…" [--status pending|active|completed|rejected]
   *     [--tech-stack "…"] [--global-constraints "…"]
   *
   * --file is required and becomes
   * docs/plans/<today's-date>-<topic>.plan.html — the date isn't a
   * flag, it's today's actual date, used for both the filename and the
   * <plan-date> field so they can never drift apart. --status defaults
   * to "pending" if omitted. No tasks are created yet.
   */
  export async function add({ fs, args, cli }) {
    const kind = args._[0]
    if (kind === "doc") return addDoc({ fs, args, cli })
    throw new Error(`unknown add kind "${kind}" — expected "doc", "task", or "step"`)
  }

  /**
   * Update fields on an existing plan-doc.
   *
   *   mycelium run plan update doc <file> [--title "…"] [--status …]
   *     [--goal "…"] [--architecture "…"] [--tech-stack "…"]
   *     [--global-constraints "…"]
   *
   * <file> is an existing docs/plans/<date>-<topic>.plan.html file. Per
   * flag: omitted leaves the field untouched, any other value upserts
   * it, an explicit empty value ("") removes an optional field.
   * plan-date is never touched here — only add sets it, once, at
   * creation.
   */
  export async function update({ fs, args, cli }) {
    const kind = args._[0]
    if (kind === "doc") return updateDoc({ fs, args, cli })
    throw new Error(`unknown update kind "${kind}" — expected "doc", "task", or "step"`)
  }
</script>
```

- [ ] **Step 3: Run `pnpm validate`, confirm no regression**

Run: `pnpm validate`

Expected: `142 checked, 0 fail` (unchanged from Task 2 — this step adds commands, not instances).

- [ ] **Step 4: Manually smoke-test `add doc`**

Run:

```bash
pnpm mycelium plan add doc --title "Test plan" --file smoke-test \
  --goal "Prove add doc works." --architecture "Write a file, check it."
```

Expected output: `wrote    plans/2026-07-25-smoke-test.plan.html` (date will match today's actual date).

Then inspect the file: `cat docs/plans/2026-07-25-smoke-test.plan.html` — confirm it contains `<plan-doc data-conforms-to="../templates/plan.template.html#plan-doc">` with `plan-title`, `plan-status` (`pending`), `plan-date`, `plan-goal`, `plan-architecture` all populated, and `<title>Plan: Test plan</title>`.

- [ ] **Step 5: Manually smoke-test `update doc`**

Run:

```bash
pnpm mycelium plan update doc 2026-07-25-smoke-test.plan.html --status active
```

Expected output: `wrote    plans/2026-07-25-smoke-test.plan.html`. Re-`cat` the file and confirm `<plan-status>active</plan-status>`.

- [ ] **Step 6: Run `pnpm validate` one more time, then delete the smoke-test file**

Run: `pnpm validate` — expected `143 checked, 0 fail` (the smoke-test plan-doc now counts too).

Delete the smoke-test artifact so it doesn't get committed: `rm docs/plans/2026-07-25-smoke-test.plan.html`, then `pnpm validate` again to confirm back to `142 checked, 0 fail`.

- [ ] **Step 7: Commit**

```bash
git add experiments/v4/docs/templates/plan.template.html
git commit -m "v4: implement plan add doc / update doc

First two of plan.template.html's four commands (add, update, check,
list) -- add/update take a doc|task|step kind as their own first
positional argument and dispatch internally, matching knowledge add
<type>'s existing convention rather than inventing hyphenated command
names. Only the doc kind is implemented so far; task/step land next."
```

Then update the task's own knowledge-action node with this commit hash.

---

### Task 4: `add task` / `update task` commands

**Files:**
- Modify: `experiments/v4/docs/templates/plan.template.html` (extend the existing `<script type="mycelium/command">` block)

**Interfaces:**
- Consumes: `requireArgs`, `directChild`, `field`, `nextId` (Task 3).
- Produces: extends the existing `add`/`update` exports with a `"task"` branch; adds local `addTask`/`updateTask` helper functions.

- [ ] **Step 1: Add addTask/updateTask, and extend the add/update dispatchers**

In `experiments/v4/docs/templates/plan.template.html`'s command script, insert `addTask`/`updateTask` right after `updateDoc` (before the `add`/`update` exports):

```js
  async function addTask({ fs, args, cli }) {
    requireArgs([args._[1], "<file>"], [args.title, "--title"], [args.files, "--files"])
    const path = `plans/${args._[1]}`
    const doc = fs.get(path)
    const planDoc = doc.querySelector("plan-doc")
    if (!planDoc) throw new Error(`${args._[1]} has no <plan-doc> root`)

    const id = nextId(planDoc, "plan-task", "task")
    const task = doc.createElement("plan-task")
    task.setAttribute("id", id)
    task.setAttribute("data-conforms-to", "../templates/plan.template.html#plan-task")

    field(doc, task, "plan-title", args.title)
    field(doc, task, "plan-status", args.status ?? "pending")
    field(doc, task, "plan-files", args.files)
    field(doc, task, "plan-interfaces", args.interfaces)

    planDoc.appendChild(task)

    const result = await cli.validate(task, path)
    if (!result.ok) throw new Error(result.errors.join("\n"))

    console.log(id)
  }

  async function updateTask({ fs, args, cli }) {
    requireArgs([args._[1], "<file>"], [args._[2], "<task-id>"])
    const path = `plans/${args._[1]}`
    const doc = fs.get(path)
    const task = doc.getElementById(args._[2])
    if (!task) throw new Error(`no <plan-task id="${args._[2]}"> found in ${args._[1]}`)

    field(doc, task, "plan-title", args.title)
    field(doc, task, "plan-status", args.status)
    field(doc, task, "plan-files", args.files)
    field(doc, task, "plan-interfaces", args.interfaces)

    const result = await cli.validate(task, path)
    if (!result.ok) throw new Error(result.errors.join("\n"))
  }
```

Then replace the `add`/`update` exports (and their doc comments) with the extended versions:

```js
  /**
   * Create a new plan-doc/plan-task.
   *
   *   mycelium run plan add doc --title "…" --file <topic> --goal "…"
   *     --architecture "…" [--status pending|active|completed|rejected]
   *     [--tech-stack "…"] [--global-constraints "…"]
   *   mycelium run plan add task <file> --title "…" --files "…"
   *     [--interfaces "…"] [--status pending|active|completed|rejected]
   *
   * doc: --file is required and becomes
   * docs/plans/<today's-date>-<topic>.plan.html — the date isn't a
   * flag, it's today's actual date, used for both the filename and the
   * <plan-date> field so they can never drift apart. --status defaults
   * to "pending" if omitted.
   *
   * task: <file> is an existing plan-doc file. Appends one
   * <plan-task id="task-N"> (N = current task count + 1) to the doc's
   * <plan-doc> root, prints the new task's id on its own line.
   */
  export async function add({ fs, args, cli }) {
    const kind = args._[0]
    if (kind === "doc") return addDoc({ fs, args, cli })
    if (kind === "task") return addTask({ fs, args, cli })
    throw new Error(`unknown add kind "${kind}" — expected "doc", "task", or "step"`)
  }

  /**
   * Update fields on an existing plan-doc/plan-task.
   *
   *   mycelium run plan update doc <file> [--title "…"] [--status …]
   *     [--goal "…"] [--architecture "…"] [--tech-stack "…"]
   *     [--global-constraints "…"]
   *   mycelium run plan update task <file> <task-id> [--title]
   *     [--status] [--files] [--interfaces]
   *
   * doc: <file> is an existing docs/plans/<date>-<topic>.plan.html
   * file. Per flag: omitted leaves the field untouched, any other
   * value upserts it, an explicit empty value ("") removes an optional
   * field. plan-date is never touched here — only add sets it, once,
   * at creation.
   *
   * task: <task-id> (e.g. "task-1") is found via getElementById.
   * Same per-flag upsert/clear convention as doc.
   */
  export async function update({ fs, args, cli }) {
    const kind = args._[0]
    if (kind === "doc") return updateDoc({ fs, args, cli })
    if (kind === "task") return updateTask({ fs, args, cli })
    throw new Error(`unknown update kind "${kind}" — expected "doc", "task", or "step"`)
  }
```

- [ ] **Step 2: Run `pnpm validate`, confirm no regression**

Run: `pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 3: Manually smoke-test `add task` and `update task`**

Run:

```bash
pnpm mycelium plan add doc --title "Test plan" --file smoke-test-2 \
  --goal "Prove add task works." --architecture "Write a task, check it."
pnpm mycelium plan add task 2026-07-25-smoke-test-2.plan.html \
  --title "First task" --files "Create: src/thing.ts"
```

Expected: second command prints `task-1` on its own line, then `wrote    plans/2026-07-25-smoke-test-2.plan.html`.

```bash
pnpm mycelium plan update task 2026-07-25-smoke-test-2.plan.html task-1 --status active
```

Inspect the file: confirm `<plan-task id="task-1" data-conforms-to="../templates/plan.template.html#plan-task">` nested inside `<plan-doc>`, with `<plan-status>active</plan-status>`.

- [ ] **Step 4: Clean up and re-validate**

Run: `rm docs/plans/2026-07-25-smoke-test-2.plan.html && pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/docs/templates/plan.template.html
git commit -m "v4: implement plan add task / update task

Extends add/update's kind dispatch with plan-task support. add task
appends a new <plan-task id=\"task-N\"> to an existing plan-doc's
root, N generated from the current direct-child plan-task count;
update task edits one by id via getElementById, same
upsert/clear-on-empty-string convention as update doc."
```

Then update the task's own knowledge-action node with this commit hash.

---

### Task 5: `add step` / `update step` commands (plan-check handling)

**Files:**
- Modify: `experiments/v4/docs/templates/plan.template.html` (extend the existing `<script type="mycelium/command">` block)

**Interfaces:**
- Consumes: `requireArgs`, `directChild`, `field` (Task 3); `addTask`/`updateTask`'s sibling pattern (Task 4).
- Produces: `buildCheck(doc, checkCommand, expectedSuccess, expectedOutput) => Element` (an unattached `<plan-check>`), consumed by Task 6's `check` command for its field shape. Extends `add`/`update` with a `"step"` branch.

- [ ] **Step 1: Add buildCheck, addStep, updateStep, and extend the dispatchers**

Insert right after `updateTask`:

```js
  function buildCheck(doc, checkCommand, expectedSuccess, expectedOutput) {
    const check = doc.createElement("plan-check")
    check.setAttribute("data-conforms-to", "../templates/plan.template.html#plan-check")
    field(doc, check, "plan-check-command", checkCommand)
    field(doc, check, "plan-check-success", expectedSuccess)
    field(doc, check, "plan-check-output", expectedOutput)
    return check
  }

  async function addStep({ fs, args, cli }) {
    requireArgs([args._[1], "<file>"], [args._[2], "<task-id>"], [args.title, "--title"])
    const path = `plans/${args._[1]}`
    const doc = fs.get(path)
    const task = doc.getElementById(args._[2])
    if (!task) throw new Error(`no <plan-task id="${args._[2]}"> found in ${args._[1]}`)

    const id = nextId(task, "plan-step", `${args._[2]}-step`)
    const step = doc.createElement("plan-step")
    step.setAttribute("id", id)
    step.setAttribute("data-conforms-to", "../templates/plan.template.html#plan-step")

    const detail = args.detail === "-" ? await cli.readStdin() : args.detail

    field(doc, step, "plan-title", args.title)
    field(doc, step, "plan-status", "pending")
    if (detail) {
      const el = doc.createElement("plan-detail")
      el.innerHTML = detail
      step.appendChild(el)
    }

    let check = null
    if (args["check-command"]) {
      check = buildCheck(doc, args["check-command"], args["expected-success"], args["expected-output"])
      step.appendChild(check)
    }

    task.appendChild(step)

    const stepResult = await cli.validate(step, path)
    if (!stepResult.ok) throw new Error(stepResult.errors.join("\n"))
    if (check) {
      const checkResult = await cli.validate(check, path)
      if (!checkResult.ok) throw new Error(checkResult.errors.join("\n"))
    }

    console.log(id)
  }

  async function updateStep({ fs, args, cli }) {
    requireArgs([args._[1], "<file>"], [args._[2], "<step-id>"])
    const path = `plans/${args._[1]}`
    const doc = fs.get(path)
    const step = doc.getElementById(args._[2])
    if (!step) throw new Error(`no <plan-step id="${args._[2]}"> found in ${args._[1]}`)

    field(doc, step, "plan-title", args.title)
    field(doc, step, "plan-status", args.status)

    const detail = args.detail === "-" ? await cli.readStdin() : args.detail
    if (detail !== undefined) {
      const existing = directChild(step, "plan-detail")
      if (detail === "") existing?.remove()
      else if (existing) existing.innerHTML = detail
      else {
        const el = doc.createElement("plan-detail")
        el.innerHTML = detail
        step.appendChild(el)
      }
    }

    let check = directChild(step, "plan-check")
    if (args["check-command"] === "") {
      check?.remove()
      check = null
    } else if (args["check-command"] !== undefined && !check) {
      check = buildCheck(doc, args["check-command"], args["expected-success"], args["expected-output"])
      step.appendChild(check)
    } else if (check) {
      field(doc, check, "plan-check-command", args["check-command"])
      field(doc, check, "plan-check-success", args["expected-success"])
      field(doc, check, "plan-check-output", args["expected-output"])
    } else if (args["expected-success"] !== undefined || args["expected-output"] !== undefined) {
      throw new Error("--expected-success/--expected-output require --check-command when no plan-check exists yet")
    }

    const stepResult = await cli.validate(step, path)
    if (!stepResult.ok) throw new Error(stepResult.errors.join("\n"))
    if (check) {
      const checkResult = await cli.validate(check, path)
      if (!checkResult.ok) throw new Error(checkResult.errors.join("\n"))
    }
  }
```

Then replace the `add`/`update` exports once more with the final, complete versions:

```js
  /**
   * Create a new plan-doc/plan-task/plan-step.
   *
   *   mycelium run plan add doc --title "…" --file <topic> --goal "…"
   *     --architecture "…" [--status pending|active|completed|rejected]
   *     [--tech-stack "…"] [--global-constraints "…"]
   *   mycelium run plan add task <file> --title "…" --files "…"
   *     [--interfaces "…"] [--status pending|active|completed|rejected]
   *   mycelium run plan add step <file> <task-id> --title "…"
   *     [--detail "…" | --detail -] [--check-command "…"]
   *     [--expected-success true|false] [--expected-output "…"]
   *
   * doc: --file is required and becomes
   * docs/plans/<today's-date>-<topic>.plan.html. --status defaults to
   * "pending" if omitted.
   *
   * task: <file> is an existing plan-doc file. Appends one
   * <plan-task id="task-N"> to the doc's <plan-doc> root, prints the
   * new task's id.
   *
   * step: <task-id> (e.g. "task-1") is found via getElementById.
   * Appends one <plan-step id="<task-id>-step-M">, status "pending",
   * inside that task. --check-command creates a nested <plan-check>
   * (plan-check-success defaults to "true" if --expected-success is
   * omitted). Prints the new step's id.
   */
  export async function add({ fs, args, cli }) {
    const kind = args._[0]
    if (kind === "doc") return addDoc({ fs, args, cli })
    if (kind === "task") return addTask({ fs, args, cli })
    if (kind === "step") return addStep({ fs, args, cli })
    throw new Error(`unknown add kind "${kind}" — expected "doc", "task", or "step"`)
  }

  /**
   * Update fields on an existing plan-doc/plan-task/plan-step.
   *
   *   mycelium run plan update doc <file> [--title "…"] [--status …]
   *     [--goal "…"] [--architecture "…"] [--tech-stack "…"]
   *     [--global-constraints "…"]
   *   mycelium run plan update task <file> <task-id> [--title]
   *     [--status] [--files] [--interfaces]
   *   mycelium run plan update step <file> <step-id> [--title]
   *     [--status pending|completed] [--detail "…" | --detail -]
   *     [--check-command "…"] [--expected-success true|false]
   *     [--expected-output "…"]
   *
   * doc/task: per-flag upsert/clear-on-empty-string convention, same as
   * every other update in this project.
   *
   * step: same per-flag convention for title/status/detail.
   * --check-command "" removes the whole nested plan-check;
   * --check-command with a non-empty value upserts plan-check-command,
   * creating the plan-check wrapper first if none exists yet;
   * --expected-success/--expected-output upsert their own fields
   * within an existing (or just-created) plan-check — passing either
   * one when no plan-check exists and --check-command wasn't also
   * given is an error.
   */
  export async function update({ fs, args, cli }) {
    const kind = args._[0]
    if (kind === "doc") return updateDoc({ fs, args, cli })
    if (kind === "task") return updateTask({ fs, args, cli })
    if (kind === "step") return updateStep({ fs, args, cli })
    throw new Error(`unknown update kind "${kind}" — expected "doc", "task", or "step"`)
  }
```

- [ ] **Step 2: Run `pnpm validate`, confirm no regression**

Run: `pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 3: Manually smoke-test `add step` with a check, and `update step`**

Run:

```bash
pnpm mycelium plan add doc --title "Test plan" --file smoke-test-3 \
  --goal "Prove add step works." --architecture "Write a step, check it."
pnpm mycelium plan add task 2026-07-25-smoke-test-3.plan.html \
  --title "First task" --files "Create: src/thing.ts"
pnpm mycelium plan add step 2026-07-25-smoke-test-3.plan.html task-1 \
  --title "Write the failing test" \
  --check-command "test -f /nonexistent-file-for-smoke-test" \
  --expected-success false
```

Expected: last command prints `task-1-step-1`, then `wrote ...`. Inspect the file: confirm `<plan-step id="task-1-step-1" ...>` nested in `<plan-task id="task-1">`, with a nested `<plan-check data-conforms-to="../templates/plan.template.html#plan-check">` containing `<plan-check-command>test -f /nonexistent-file-for-smoke-test</plan-check-command>` and `<plan-check-success>false</plan-check-success>`.

```bash
pnpm mycelium plan update step 2026-07-25-smoke-test-3.plan.html task-1-step-1 \
  --expected-output "no such file"
```

Confirm `<plan-check-output>no such file</plan-check-output>` was added to the existing `plan-check` without disturbing `plan-check-command`/`plan-check-success`.

- [ ] **Step 4: Clean up and re-validate**

Run: `rm docs/plans/2026-07-25-smoke-test-3.plan.html && pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/docs/templates/plan.template.html
git commit -m "v4: implement plan add step / update step

Extends add/update's kind dispatch with plan-step support, including
a nested plan-check (its own conforming type, not a plain field --
add step/update step each validate the plan-step and, when present,
its plan-check separately). update step's --check-command handles
create/edit/clear of the whole plan-check wrapper depending on
whether one already exists and what value is passed."
```

Then update the task's own knowledge-action node with this commit hash.

---

### Task 6: `check` command

**Files:**
- Modify: `experiments/v4/docs/templates/plan.template.html` (extend the existing `<script type="mycelium/command">` block)

**Interfaces:**
- Consumes: `directChild`, `field` (Task 3); the `plan-check-command`/`plan-check-success`/`plan-check-output` shape `buildCheck` produces (Task 5).
- Produces: `export async function check({fs, args, cli})`.

- [ ] **Step 1: Add the shell-out helper and the check command**

Add the import at the top of the script block (alongside the existing `import { todayDate } from "./shared.ts"`):

```js
  import { execSync } from "node:child_process"
```

Insert `runCheckCommand` and the `check` export after `updateStep`:

```js
  function runCheckCommand(command) {
    try {
      const stdout = execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      return { success: true, output: stdout }
    } catch (err) {
      return { success: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` }
    }
  }

  /**
   * Run the plan-check(s) attached to one step, or every step in the doc.
   *
   *   mycelium run plan check <file> [<step-id>]
   *
   * Shells out to each plan-check-command found (one named step, or
   * every plan-step with a plan-check if no step-id is given) via
   * node:child_process, compares the exit code against
   * plan-check-success (default "true" — exit 0 required; "false" —
   * nonzero required) and, if plan-check-output is present,
   * substring-matches it against combined stdout+stderr. On a pass,
   * flips that step's plan-status to "completed" — a failing check
   * leaves status untouched, since a red step mid-TDD-cycle isn't
   * abandoned, just not done yet. Steps with no plan-check are
   * skipped, not touched. Throws (nonzero exit) if any checked step
   * failed.
   */
  export async function check({ fs, args, cli }) {
    requireArgs([args._[0], "<file>"])
    const path = `plans/${args._[0]}`
    const doc = fs.get(path)
    const stepId = args._[1]

    const steps = stepId
      ? [doc.getElementById(stepId)].filter(Boolean)
      : Array.from(doc.querySelectorAll("plan-step"))
    if (stepId && steps.length === 0) throw new Error(`no <plan-step id="${stepId}"> found in ${args._[0]}`)

    let anyFail = false
    for (const step of steps) {
      const checkEl = directChild(step, "plan-check")
      if (!checkEl) {
        if (stepId) console.log(`SKIP  ${step.id}  (no plan-check)`)
        continue
      }
      const commandEl = directChild(checkEl, "plan-check-command")
      if (!commandEl) throw new Error(`<plan-step id="${step.id}"> has a <plan-check> with no <plan-check-command>`)
      const command = commandEl.textContent.trim()
      const expectedSuccess = (directChild(checkEl, "plan-check-success")?.textContent.trim() ?? "true") !== "false"
      const expectedOutput = directChild(checkEl, "plan-check-output")?.textContent.trim()

      const { success, output } = runCheckCommand(command)
      const outputOk = expectedOutput ? output.includes(expectedOutput) : true
      const pass = success === expectedSuccess && outputOk

      if (pass) {
        field(doc, step, "plan-status", "completed")
        console.log(`PASS  ${step.id}`)
      } else {
        anyFail = true
        const reason = success !== expectedSuccess
          ? `command ${success ? "succeeded" : "failed"}, expected ${expectedSuccess ? "success" : "failure"}`
          : `output missing "${expectedOutput}"`
        console.log(`FAIL  ${step.id}  (${reason})`)
      }
    }

    const result = await cli.validate(doc.querySelector("plan-doc"), path)
    if (!result.ok) throw new Error(result.errors.join("\n"))
    if (anyFail) throw new Error("one or more checks failed")
  }
```

- [ ] **Step 2: Run `pnpm validate`, confirm no regression**

Run: `pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 3: Manually smoke-test `check` — a passing case**

Run:

```bash
pnpm mycelium plan add doc --title "Test plan" --file smoke-test-4 \
  --goal "Prove check works." --architecture "Add a step with a real check, run it."
pnpm mycelium plan add task 2026-07-25-smoke-test-4.plan.html \
  --title "First task" --files "Create: src/thing.ts"
pnpm mycelium plan add step 2026-07-25-smoke-test-4.plan.html task-1 \
  --title "A step that passes" --check-command "true"
pnpm mycelium plan check 2026-07-25-smoke-test-4.plan.html task-1-step-1
```

Expected: `PASS  task-1-step-1`, then `wrote    plans/2026-07-25-smoke-test-4.plan.html`, exit code 0. Inspect the file: confirm `<plan-status>completed</plan-status>` on `task-1-step-1` (flipped automatically from `pending`).

- [ ] **Step 4: Manually smoke-test `check` — a failing case**

Run:

```bash
pnpm mycelium plan add step 2026-07-25-smoke-test-4.plan.html task-1 \
  --title "A step that fails" --check-command "false"
pnpm mycelium plan check 2026-07-25-smoke-test-4.plan.html task-1-step-2 ; echo "exit: $?"
```

Expected: `FAIL  task-1-step-2  (command failed, expected success)`, then a thrown-error message, `exit: 1`. Inspect the file: confirm `task-1-step-2`'s `plan-status` is still `pending` (untouched by the failed check).

- [ ] **Step 5: Clean up and re-validate**

Run: `rm docs/plans/2026-07-25-smoke-test-4.plan.html && pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/docs/templates/plan.template.html
git commit -m "v4: implement plan check

Shells out to each plan-check-command via node:child_process -- the
first command in this project to do so. Compares the exit code
against plan-check-success (default true) and, if present,
substring-matches plan-check-output against combined stdout+stderr.
Only a passing check flips its step's plan-status to completed; a
failing check leaves status untouched rather than marking it rejected."
```

Then update the task's own knowledge-action node with this commit hash.

---

### Task 7: `list` command

**Files:**
- Modify: `experiments/v4/docs/templates/plan.template.html` (extend the existing `<script type="mycelium/command">` block)

**Interfaces:**
- Consumes: `directChild`, `requireArgs` (Task 3).
- Produces: `export function list({fs, args})`.

- [ ] **Step 1: Add the list command**

Insert after `check`:

```js
  /**
   * Print a flat progress view of every step in a plan-doc.
   *
   *   mycelium run plan list <file>
   *
   * One line per plan-step: task id, task title, step id, step title,
   * status, and a [has-check] marker (blank if the step has no
   * plan-check). Doesn't re-run any checks — reports whatever
   * plan-status is already on disk.
   */
  export function list({ fs, args }) {
    requireArgs([args._[0], "<file>"])
    const path = `plans/${args._[0]}`
    const doc = fs.get(path)
    const oneLine = (text) => text.trim().replace(/\s+/g, " ")

    for (const task of Array.from(doc.querySelectorAll("plan-task"))) {
      const taskTitle = oneLine(directChild(task, "plan-title")?.textContent ?? "")
      const steps = Array.from(task.children).filter((c) => c.tagName.toLowerCase() === "plan-step")
      for (const step of steps) {
        const stepTitle = oneLine(directChild(step, "plan-title")?.textContent ?? "")
        const status = oneLine(directChild(step, "plan-status")?.textContent ?? "")
        const hasCheck = directChild(step, "plan-check") ? "[has-check]" : ""
        console.log(`${task.id}\t${taskTitle}\t${step.id}\t${stepTitle}\t${status}\t${hasCheck}`)
      }
    }
  }
```

- [ ] **Step 2: Run `pnpm validate`, confirm no regression**

Run: `pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 3: Manually smoke-test `list`**

Run:

```bash
pnpm mycelium plan add doc --title "Test plan" --file smoke-test-5 \
  --goal "Prove list works." --architecture "Add two steps, list them."
pnpm mycelium plan add task 2026-07-25-smoke-test-5.plan.html \
  --title "First task" --files "Create: src/thing.ts"
pnpm mycelium plan add step 2026-07-25-smoke-test-5.plan.html task-1 \
  --title "Step one" --check-command "true"
pnpm mycelium plan add step 2026-07-25-smoke-test-5.plan.html task-1 \
  --title "Step two"
pnpm mycelium plan list 2026-07-25-smoke-test-5.plan.html
```

Expected two tab-separated lines, e.g.:

```
task-1	First task	task-1-step-1	Step one	pending	[has-check]
task-1	First task	task-1-step-2	Step two	pending	
```

- [ ] **Step 4: Clean up and re-validate**

Run: `rm docs/plans/2026-07-25-smoke-test-5.plan.html && pnpm validate` — expected `142 checked, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/docs/templates/plan.template.html
git commit -m "v4: implement plan list

Flat progress view over every plan-step in a plan-doc -- task id,
task title, step id, step title, status, [has-check] marker. Doesn't
re-run checks, just reports plan-status already on disk. Completes
all four planned commands (add, update, check, list)."
```

Then update the task's own knowledge-action node with this commit hash. Also link the final task's action node to a new `knowledge-outcome` node summarizing that `plan.template.html` is complete, linked back to the root goal — per CLAUDE.md's rule that a genuinely new result (not just "the commit happened as planned") earns its own outcome node.

---

## Self-Review

**1. Spec coverage** (against `experiments/v4/docs/specs/2026-07-25-plan-template-design.spec.html`):
- Tag family & file shape (4 nested types, required/optional fields) → Task 2. ✓
- Prerequisite validator fix → Task 1. ✓
- `plan-check` as a 4th conforming type → Tasks 2 (schema) + 5 (add/update step) + 6 (check command reads it). ✓
- Cross-linking (`data-rel="implements"` to a spec-doc, `leads_to` to knowledge nodes) → Not a command's job; this is authored by hand via a plain `<a data-rel>`, the same way every other family's cross-links are — correctly out of scope for this plan's own tasks, since no family's `add`/`update` command in this codebase ever authors arbitrary cross-references itself (spec-doc's own `add`/`update` don't either — see `spec.template.html`'s own note that a spec's cross-references live inside its rich fields' own markup, not a separate operation).
- CLI commands (`add`/`update`/`check`/`list`) → Tasks 3–7. ✓
- Out-of-scope items (spec-to-plan auto-generation, task-status rollup, regex checks) → correctly not implemented.

**2. Placeholder scan:** No TBD/TODO. Every step shows complete, runnable code or an exact shell command with expected output.

**3. Type consistency:** `field(doc, root, tag, text)` signature is identical across every call site from Task 3 onward. `directChild(root, tag)` likewise. `buildCheck`'s 4-argument signature (Task 5) matches exactly how Task 6's `check` command reads the same three child tags back out. `nextId(root, tag, prefix)` is used identically in `addTask` (`nextId(planDoc, "plan-task", "task")`) and `addStep` (`nextId(task, "plan-step", \`${args._[2]}-step\`)`) — same three-argument shape, different arguments.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-25-plan-template-html.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
