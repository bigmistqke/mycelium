# Template Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `docs/templates/template.template.html`, a generic validator that reads `required`/`pattern`/`enum` attributes directly off each type's existing `<template>` field placeholders, wire the crawler to fall back to it when a type has no hand-written validator, then migrate all six `knowledge-*` types and `spec-doc` to use it — deleting their seven hand-written `check()` functions.

**Architecture:** One new file (`template.template.html`) holds the vocabulary documentation and one exported function, `validateFromTemplate(templateEl, instanceEl)`, imported cross-file the same id-addressable way `knowledge.template.html`'s own `extractGraph` already is. `src/utils.ts` and `src/validate.ts` both gain a fallback path: when a type has no `data-validates` script, use the generic function instead of failing; when a type has both, run the generic check first and the hand-written one after, combining results (schema-first, custom-additive — never a replacement for the generic pass). Once that's wired and verified against a throwaway fixture, the two existing family files are migrated for real.

**Tech Stack:** Node ≥24, TypeScript via Node's native type stripping (no build step, no type-checker gate), happy-dom (already a dependency), the existing `script-hooks.ts` virtual-module import mechanism (already registered by both `validate.ts` and `run.ts`). No test framework — verification is running the tool directly against scratch copies and small throwaway scripts, same as every prior task in this project.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-25-template-schema.spec.html` — read it before starting.
- No new dependencies.
- Run all `pnpm`/`node` commands from `experiments/v4/`, except scratch-copy subshells, which set their own directory.
- **`run.ts` always resolves `docs/` relative to the current working directory** (hardcoded, no directory argument) — unlike `validate.ts`, which accepts one (`process.argv[2] ?? "./docs"`). Any scratch verification that needs `run.ts`'s CLI dispatch must `cd` into the scratch copy first; this plan avoids that entirely by calling `validateInstance`/`validateFromTemplate` directly instead, so no task needs it.
- The confidence field's new `pattern` is `^(0|[1-9][0-9]?|100)$` — matches only the literal integers 0 through 100, no leading zeros. Stricter than today's `^\d+$` + separate numeric-range check, but verified against every confidence value in the real corpus (`50 55 60 65 70 75 80 85 86 88 90 92`) — all match, so this is not a behavior change for any existing node.
- The browser-side "live-demo" `<script>` blocks already in `knowledge.template.html` and `spec.template.html` (the ones with their own inline `checkGeneric`) are **out of scope** — they don't read the `data-validates` scripts being deleted, so deleting those scripts doesn't affect them, and this plan doesn't touch them.
- `template.template.html` gets **no browser live-demo section and no `template.template.css`** — it declares no new custom elements (the schema lives as attributes on elements `knowledge.template.css`/`spec.template.css` already style), so there's nothing new to render or demo in-browser. It's verified via direct Node-side scripts instead, the same way `extractGraph` (also not itself an instance-bearing type) is exercised by the `generate` command rather than a live-demo.
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go. This plan's own goal/decision chain already exists: `2026-07-25-template-template-html-now-prerequisite.decision.html` → `2026-07-25-template-schema-via-attributes.decision.html` → `2026-07-25-schema-first-then-optional-validator-function.decision.html`. Record actions against that chain (e.g. `pnpm mycelium knowledge add action --title "…" --file … ` linked `depends_on` the relevant decision, and an outcome once `pnpm validate` passes at the end).

---

### Task 1: Create `template.template.html` — vocabulary docs + the generic validator function

**Files:**
- Create: `experiments/v4/docs/templates/template.template.html`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: a script `<script type="module" id="validate-from-template">` exporting `validateFromTemplate(templateEl: HTMLTemplateElement, instanceRoot: Element): { ok: boolean; errors: string[] }`. Task 2 imports this via the existing cross-file virtual-module mechanism (`"<path>/template.template.html#validate-from-template"`).

- [ ] **Step 1: Write the file**

Create `experiments/v4/docs/templates/template.template.html` with this exact content:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Templates: template.template.html — the schema vocabulary</title>
<link rel="stylesheet" href="../theme.css">
</head>
<body>

<h1>Templates: template.template.html — the schema vocabulary</h1>
<div class="meta">
  <div><b>Purpose:</b> documents the <code>required</code>/<code>pattern</code>/<code>enum</code> attribute
    vocabulary that turns an existing <code>&lt;template id="…"&gt;</code> skeleton into a machine-readable
    schema, and hosts the one generic validator function that reads it</div>
  <div><b>Not a node type:</b> unlike <code>knowledge.template.html</code> or <code>spec.template.html</code>,
    this file declares no <code>&lt;template id="…"&gt;</code> of its own and nothing conforms to it via
    <code>data-conforms-to</code> — there are only ever a handful of <code>*.template.html</code> files,
    hand-authored, never mixed, so the <code>.template.html</code> filename suffix is already sufficient
    signal that a file follows this convention. Nothing here needs crawler enforcement.</div>
  <div><b>Sibling of:</b> <code>knowledge.template.html</code>, <code>spec.template.html</code></div>
</div>

<h2>The vocabulary</h2>
<p>
  Every type's <code>&lt;template id="…"&gt;</code> already contains one empty placeholder element per
  field, for documentation/copy-paste. Three optional attributes on those placeholders turn that skeleton
  into a schema, without adding any new wrapper elements:
</p>
<ul>
  <li><code>required</code> — boolean attribute (no value). The field must be present with non-empty text.
    Absent entirely, or present but only whitespace, both fail the same way: "missing or empty".</li>
  <li><code>pattern</code> — a JS regular expression source, tested against the field's trimmed text
    content.</li>
  <li><code>enum</code> — a whitespace-separated list of the only exact values the field's trimmed text may
    take.</li>
</ul>
<p>
  A field with none of the three is optional and free-form: any content is allowed, or the field may be
  omitted entirely — but if it's present at all, it still can't be empty (present-but-whitespace-only is
  always rejected, required or not, with "present but empty — omit it instead"). The full set of field tags
  declared inside a type's <code>&lt;template&gt;</code> is also its <em>allowed</em> set: any same-family
  field on a real instance that isn't among them is rejected as unexpected.
</p>
<pre><code>&lt;template id="knowledge-goal"&gt;
  &lt;knowledge-goal&gt;
    &lt;knowledge-title required&gt;&lt;/knowledge-title&gt;
    &lt;knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"&gt;&lt;/knowledge-confidence&gt;
    &lt;knowledge-status required enum="pending active completed rejected"&gt;&lt;/knowledge-status&gt;
    &lt;knowledge-prompt&gt;&lt;/knowledge-prompt&gt;
    &lt;knowledge-detail&gt;&lt;/knowledge-detail&gt;
  &lt;/knowledge-goal&gt;
&lt;/template&gt;</code></pre>

<h2>The generic validator</h2>
<p>
  Given a type's <code>&lt;template&gt;</code> element and a real instance element, reads the vocabulary
  above straight out of the template's own content and performs the same four checks every hand-written
  <code>check()</code> function in this project used to write by hand: required-and-non-empty, pattern,
  enum, and unexpected/empty-optional fields. A <code>&lt;template&gt;</code>'s children live in
  <code>.content</code>, a separate inert <code>DocumentFragment</code> — reading a field's attributes goes
  through <code>templateEl.content</code>, not the template element directly (verified against happy-dom,
  the DOM engine this project runs on).
</p>
<script type="module" id="validate-from-template">
  // Given a type's own <template> definition (with required/pattern/enum
  // attributes on its field placeholders) and a real instance element,
  // validates the instance purely from what the template declares -- no
  // per-type code. See "The generic validator" above.
  export function validateFromTemplate(templateEl, instanceRoot) {
    const shape = templateEl.content.firstElementChild
    const rootTag = shape.tagName.toLowerCase()
    const el = instanceRoot.tagName?.toLowerCase() === rootTag
      ? instanceRoot
      : instanceRoot.querySelector(rootTag)
    if (!el) return { ok: false, errors: [`missing <${rootTag}> element`] }

    const familyPrefix = rootTag.split('-')[0] + '-'
    const allowed = []
    const errors = []

    for (const field of Array.from(shape.children)) {
      const tag = field.tagName.toLowerCase()
      allowed.push(tag)
      const required = field.hasAttribute('required')
      const node = el.querySelector(tag)
      const text = node?.textContent.trim() ?? ''

      if (!node) {
        if (required) errors.push(`missing or empty <${tag}>`)
        continue
      }
      if (!text) {
        errors.push(required ? `missing or empty <${tag}>` : `<${tag}> present but empty — omit it instead`)
        continue
      }

      const pattern = field.getAttribute('pattern')
      if (pattern && !new RegExp(pattern).test(text)) {
        errors.push(`<${tag}> must match ${pattern}, got "${text}"`)
      }
      const enumAttr = field.getAttribute('enum')
      if (enumAttr) {
        const values = enumAttr.trim().split(/\s+/)
        if (!values.includes(text)) errors.push(`<${tag}> must be ${values.join('|')}, got "${text}"`)
      }
    }

    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith(familyPrefix) && !allowed.includes(tag)) {
        errors.push(`unexpected <${tag}> on ${rootTag}`)
      }
    }

    return { ok: errors.length === 0, errors }
  }
</script>

<h2>Checking order: schema first, hand-written validator second</h2>
<p>
  A type may still declare its own <code>&lt;script data-validates&gt;</code> alongside its
  <code>&lt;template&gt;</code>, for logic this vocabulary genuinely can't express. When one exists, the
  crawler runs the generic check above first, then the hand-written one, and a node is only valid if both
  pass — the hand-written script is additional validation layered on top of the schema, never a replacement
  for it. None of this project's seven existing types need one any more; see
  <a data-rel="elaborates" href="../knowledge/2026-07-25-schema-first-then-optional-validator-function.decision.html">the
  decision record</a>.
</p>

</body>
</html>
```

- [ ] **Step 2: Verify the generic validator directly, with no other task's code involved**

Create a throwaway script at `experiments/v4/verify-tmp.mjs` (not committed — deleted in Step 4):

```js
import { register } from "node:module"
import { pathToFileURL } from "node:url"
import { resolve as resolvePath } from "node:path"

register("./src/script-hooks.ts", import.meta.url)
const { parseHTML } = await import("./src/utils.ts")

const templateFile = resolvePath("./docs/templates/template.template.html")
const { validateFromTemplate } = await import(`${pathToFileURL(templateFile).href}#validate-from-template`)

function makeTemplate(fieldsHtml) {
  const { document } = parseHTML(`<!DOCTYPE html><html><body><template id="t">
    <knowledge-goal>${fieldsHtml}</knowledge-goal>
  </template></body></html>`)
  return document.querySelector("template#t")
}
function makeInstance(html) {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)
  return document.body.firstElementChild
}

const fields = `
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-status required enum="pending active completed rejected"></knowledge-status>
    <knowledge-prompt></knowledge-prompt>
`
const template = makeTemplate(fields)

let failures = 0
function check(label, html, expectOk, expectSubstring) {
  const instance = makeInstance(html)
  const result = validateFromTemplate(template, instance)
  const ok = result.ok === expectOk && (!expectSubstring || result.errors.some((e) => e.includes(expectSubstring)))
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : "  " + JSON.stringify(result)}`)
}

check(
  "valid instance passes",
  `<knowledge-goal><knowledge-title>t</knowledge-title><knowledge-confidence>50</knowledge-confidence><knowledge-status>active</knowledge-status></knowledge-goal>`,
  true,
)
check(
  "missing required field fails",
  `<knowledge-goal><knowledge-confidence>50</knowledge-confidence><knowledge-status>active</knowledge-status></knowledge-goal>`,
  false,
  "missing or empty <knowledge-title>",
)
check(
  "out-of-range confidence fails",
  `<knowledge-goal><knowledge-title>t</knowledge-title><knowledge-confidence>150</knowledge-confidence><knowledge-status>active</knowledge-status></knowledge-goal>`,
  false,
  "must match",
)
check(
  "bad status enum value fails",
  `<knowledge-goal><knowledge-title>t</knowledge-title><knowledge-confidence>50</knowledge-confidence><knowledge-status>bogus</knowledge-status></knowledge-goal>`,
  false,
  "must be pending|active|completed|rejected",
)
check(
  "unexpected field fails",
  `<knowledge-goal><knowledge-title>t</knowledge-title><knowledge-confidence>50</knowledge-confidence><knowledge-status>active</knowledge-status><knowledge-commit>abc</knowledge-commit></knowledge-goal>`,
  false,
  "unexpected <knowledge-commit>",
)
check(
  "optional field present but empty fails",
  `<knowledge-goal><knowledge-title>t</knowledge-title><knowledge-confidence>50</knowledge-confidence><knowledge-status>active</knowledge-status><knowledge-prompt></knowledge-prompt></knowledge-goal>`,
  false,
  "present but empty",
)
check(
  "optional field absent passes",
  `<knowledge-goal><knowledge-title>t</knowledge-title><knowledge-confidence>50</knowledge-confidence><knowledge-status>active</knowledge-status></knowledge-goal>`,
  true,
)

if (failures > 0) process.exit(1)
```

Run:

```bash
cd experiments/v4
node verify-tmp.mjs
```

Expected: seven `PASS` lines, nothing else, exit code 0.

- [ ] **Step 3: Verify `pnpm validate` is unaffected**

```bash
pnpm validate
```

Expected: `118 checked, 0 fail` (this task adds a new file that nothing yet references, so the count matches whatever it was before this task — confirm it's unchanged from before Step 1, not a specific hardcoded number, since prior sessions may have added nodes).

- [ ] **Step 4: Delete the throwaway script**

```bash
rm experiments/v4/verify-tmp.mjs
```

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/docs/templates/template.template.html
git commit -m "experiment(v4): add template.template.html — schema vocabulary and generic validator

Documents the required/pattern/enum attribute vocabulary that turns an
existing <template id> skeleton into a machine-readable schema, and
hosts validateFromTemplate, the one generic function that reads it.
Declares no <template> of its own -- unlike knowledge.template.html or
spec.template.html it isn't a node type with real instances, so
nothing conforms to it and there's no live-demo or dedicated CSS file.
Not yet imported from anywhere; that's the next task."
```

---

### Task 2: Wire the crawler to fall back to the generic validator, schema-first

**Files:**
- Modify: `experiments/v4/src/utils.ts`
- Modify: `experiments/v4/src/validate.ts`

**Interfaces:**
- Consumes: `validateFromTemplate`, importable from `experiments/v4/docs/templates/template.template.html#validate-from-template` (Task 1).
- Produces: `loadGenericValidator(docsDir: string): Promise<(templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }>`, exported from `experiments/v4/src/utils.ts`. `validateInstance` (already exported from the same file) now falls back to it. `validate.ts`'s `TemplateInfo` interface gains an `element: Element` field, populated at discovery time; its per-instance check loop now always runs the generic check and layers a hand-written one on top when present. Task 3 and Task 4 rely on both of these: once a type's `<script data-validates>` is deleted, both `validate.ts`'s whole-corpus pass and `utils.ts`'s `validateInstance` (used by `run.ts`'s `add`/`update`) must keep validating that type correctly via the generic path alone.

- [ ] **Step 1: Add `loadGenericValidator` to `utils.ts`, update `validateInstance`**

In `experiments/v4/src/utils.ts`, find:

```ts
export async function loadCheck(filePath: string, script: Element): Promise<(...args: unknown[]) => unknown> {
  const mod = await loadModule(filePath, script)
  return mod.check as (...args: unknown[]) => unknown
}
```

Replace with:

```ts
export async function loadCheck(filePath: string, script: Element): Promise<(...args: unknown[]) => unknown> {
  const mod = await loadModule(filePath, script)
  return mod.check as (...args: unknown[]) => unknown
}

// Imports the one generic validator shared by every type that doesn't
// declare its own data-validates script (see template.template.html).
// A plain dynamic import, resolved by the same script-hooks.ts hook
// loadCheck's own loadModule relies on -- both run.ts and validate.ts
// already call register() before either of them ever reaches this
// function, so the hook is always active by the time it's called.
export async function loadGenericValidator(
  docsDir: string,
): Promise<(templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }> {
  const templateTemplateFile = resolvePath(docsDir, "templates/template.template.html")
  const mod = await import(`${pathToFileURL(templateTemplateFile).href}#validate-from-template`)
  return mod.validateFromTemplate as (templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }
}
```

Then find `validateInstance`'s body:

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
    const script = (document as unknown as Document).querySelector(`script[data-validates="#${fragId}"]`)

    if (!script) return { ok: false, errors: [`no template found at ${key}`] }

    const check = await loadCheck(templateFile, script)
    const result = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    return { ok: result.ok, errors: (result.errors ?? result.violations ?? []) as string[] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${(err as Error).message}`] }
  }
}
```

Replace with:

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
    const doc = document as unknown as Document
    const templateEl = doc.querySelector(`template#${fragId}`)
    if (!templateEl) return { ok: false, errors: [`no template found at ${key}`] }

    const genericCheck = await loadGenericValidator(docsDir)
    const generic = genericCheck(templateEl as unknown as Element, element)

    const script = doc.querySelector(`script[data-validates="#${fragId}"]`)
    if (!script) return generic

    const check = await loadCheck(templateFile, script)
    const custom = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    const customErrors = (custom.errors ?? custom.violations ?? []) as string[]
    return { ok: generic.ok && custom.ok, errors: [...generic.errors, ...customErrors] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${(err as Error).message}`] }
  }
}
```

- [ ] **Step 2: Verify `utils.ts` still loads cleanly**

```bash
cd experiments/v4
node -e "import('./src/utils.ts').then(m => console.log(Object.keys(m)))"
```

Expected: includes `loadGenericValidator` and `validateInstance` among the printed export names, no error.

- [ ] **Step 3: Update `validate.ts`'s `TemplateInfo`, discovery, and per-instance check loop**

In `experiments/v4/src/validate.ts`, find:

```ts
import { parseHTML, walkHtmlFiles, resolveTemplateRef, loadCheck } from "./utils.ts"
```

Replace with:

```ts
import { parseHTML, walkHtmlFiles, resolveTemplateRef, loadCheck, loadGenericValidator } from "./utils.ts"
```

Find:

```ts
interface TemplateInfo {
  id: string
  file: string
  validatorScript: Element | null
}
```

Replace with:

```ts
interface TemplateInfo {
  id: string
  file: string
  element: Element
  validatorScript: Element | null
}
```

Find:

```ts
    for (const tpl of Array.from(dom.querySelectorAll("template[id]"))) {
      const id = tpl.getAttribute("id")!
      templates.set(`${path}#${id}`, { id, file: path, validatorScript: null })
    }
```

Replace with:

```ts
    for (const tpl of Array.from(dom.querySelectorAll("template[id]"))) {
      const id = tpl.getAttribute("id")!
      templates.set(`${path}#${id}`, { id, file: path, element: tpl, validatorScript: null })
    }
```

Find:

```ts
  const templatesDir = resolvePath(dir, "templates") + sep
  const auditDocuments = documents.filter((d) => !d.path.startsWith(templatesDir))

  let checked = 0
  let fail = 0
  const failures: string[] = []

  for (const instance of instances) {
    checked++
    const key = resolveTemplateRef(instance.file, instance.conformsTo)
    const template = templates.get(key)
    const label = `${relative(dir, instance.file)}  (${instance.conformsTo})`

    if (!template || !template.validatorScript) {
      fail++
      failures.push(`FAIL  ${label}\n      no template found at ${key}`)
      continue
    }

    try {
      const check = await loadCheck(template.file, template.validatorScript)
      const result = check(instance.element) as CheckResult
      if (!result.ok) {
        fail++
        failures.push(`FAIL  ${label}\n${formatItems(result)}`)
      }
    } catch (err) {
      fail++
      failures.push(`FAIL  ${label}\n      validator threw — ${(err as Error).message}`)
    }
  }
```

Replace with:

```ts
  const templatesDir = resolvePath(dir, "templates") + sep
  const auditDocuments = documents.filter((d) => !d.path.startsWith(templatesDir))
  const genericCheck = await loadGenericValidator(dir)

  let checked = 0
  let fail = 0
  const failures: string[] = []

  for (const instance of instances) {
    checked++
    const key = resolveTemplateRef(instance.file, instance.conformsTo)
    const template = templates.get(key)
    const label = `${relative(dir, instance.file)}  (${instance.conformsTo})`

    if (!template) {
      fail++
      failures.push(`FAIL  ${label}\n      no template found at ${key}`)
      continue
    }

    try {
      const generic = genericCheck(template.element, instance.element)
      let result: CheckResult = generic
      if (template.validatorScript) {
        const customCheck = await loadCheck(template.file, template.validatorScript)
        const custom = customCheck(instance.element) as CheckResult
        const customErrors = (custom.errors ?? custom.violations ?? []) as string[]
        result = { ok: generic.ok && custom.ok, errors: [...generic.errors, ...customErrors] }
      }
      if (!result.ok) {
        fail++
        failures.push(`FAIL  ${label}\n${formatItems(result)}`)
      }
    } catch (err) {
      fail++
      failures.push(`FAIL  ${label}\n      validator threw — ${(err as Error).message}`)
    }
  }
```

- [ ] **Step 4: Verify `pnpm validate` still passes, unchanged, on the real repo**

```bash
pnpm validate
```

Expected: the exact same `N checked, 0 fail` count as before this task. Every real type still has its `data-validates` script (Tasks 3/4 haven't run yet) and no `required`/`pattern`/`enum` attributes yet, so the generic check runs but never finds anything to reject — the custom check still does all the real work, same as before.

- [ ] **Step 5: Build a scratch fixture proving the fallback and the combined path both work**

```bash
cd /path/to/mycelium   # repo root
V4="$(pwd)/experiments/v4"
SCRATCH=$(mktemp -d)
mkdir -p "$SCRATCH/templates" "$SCRATCH/widgets"
cp "$V4/docs/templates/template.template.html" "$SCRATCH/templates/template.template.html"
```

Create `$SCRATCH/templates/widget.template.html`:

```bash
cat > "$SCRATCH/templates/widget.template.html" << 'EOF'
<!DOCTYPE html>
<html><body>

<template id="widget-thing">
  <widget-thing>
    <widget-name required></widget-name>
  </widget-thing>
</template>

<template id="widget-picky">
  <widget-picky>
    <widget-name required></widget-name>
  </widget-picky>
</template>
<script type="module" data-validates="#widget-picky">
  export function check(root) {
    const el = root.matches?.('widget-picky') ? root : root.querySelector('widget-picky')
    const name = el.querySelector('widget-name')?.textContent.trim() ?? ''
    const errors = name.includes('forbidden') ? [`widget-name may not contain "forbidden", got "${name}"`] : []
    return { ok: errors.length === 0, errors }
  }
</script>

</body></html>
EOF
```

Create the instance files:

```bash
cat > "$SCRATCH/widgets/good-thing.html" << 'EOF'
<!DOCTYPE html><html><body>
<widget-thing data-conforms-to="../templates/widget.template.html#widget-thing">
  <widget-name>hello</widget-name>
</widget-thing>
</body></html>
EOF

cat > "$SCRATCH/widgets/bad-thing.html" << 'EOF'
<!DOCTYPE html><html><body>
<widget-thing data-conforms-to="../templates/widget.template.html#widget-thing">
</widget-thing>
</body></html>
EOF

cat > "$SCRATCH/widgets/good-picky.html" << 'EOF'
<!DOCTYPE html><html><body>
<widget-picky data-conforms-to="../templates/widget.template.html#widget-picky">
  <widget-name>fine</widget-name>
</widget-picky>
</body></html>
EOF

cat > "$SCRATCH/widgets/forbidden-picky.html" << 'EOF'
<!DOCTYPE html><html><body>
<widget-picky data-conforms-to="../templates/widget.template.html#widget-picky">
  <widget-name>this is forbidden</widget-name>
</widget-picky>
</body></html>
EOF

cat > "$SCRATCH/widgets/empty-picky.html" << 'EOF'
<!DOCTYPE html><html><body>
<widget-picky data-conforms-to="../templates/widget.template.html#widget-picky">
</widget-picky>
</body></html>
EOF
```

- [ ] **Step 6: Run `validate.ts` against the scratch fixture**

```bash
node "$V4/src/validate.ts" "$SCRATCH" 2>&1
```

Expected: `5 checked, 3 fail`, with failures for:
- `bad-thing.html` — `missing or empty <widget-name>` (generic-only fallback: `widget-thing` has no `data-validates` script at all)
- `forbidden-picky.html` — `widget-name may not contain "forbidden"` (generic passes, since `widget-name` is present and non-empty; the hand-written script is what catches this — proves the custom check still runs and still matters)
- `empty-picky.html` — `missing or empty <widget-name>` (generic catches this even though `widget-picky` *has* a hand-written script — proves the generic check runs even when a custom one exists, not skipped in its favor)

`good-thing.html` and `good-picky.html` must not appear in the failures.

- [ ] **Step 7: Verify `utils.ts`'s `validateInstance` agrees, via a direct call (not `run.ts`'s CLI)**

`validateInstance` internally imports the generic validator through the same virtual-module mechanism `loadCheck` uses, so this verification needs `register()` called first with a real `import.meta.url` — a `node -e` one-liner can't do that (no `import.meta` in CommonJS eval context). Write a real script instead, at `experiments/v4/verify-tmp-2.mjs` (not committed — deleted in the next step):

```js
import { register } from "node:module"
import { readFileSync } from "node:fs"

register("./src/script-hooks.ts", import.meta.url)
const { parseHTML, validateInstance } = await import("./src/utils.ts")

const SCRATCH = process.argv[2]
const read = (p) => parseHTML(readFileSync(p, "utf8")).document

const good = read(`${SCRATCH}/widgets/good-thing.html`).querySelector("widget-thing")
const bad = read(`${SCRATCH}/widgets/bad-thing.html`).querySelector("widget-thing")
const forbidden = read(`${SCRATCH}/widgets/forbidden-picky.html`).querySelector("widget-picky")

console.log("good-thing:", JSON.stringify(await validateInstance(SCRATCH, "widgets/good-thing.html", good)))
console.log("bad-thing:", JSON.stringify(await validateInstance(SCRATCH, "widgets/bad-thing.html", bad)))
console.log("forbidden-picky:", JSON.stringify(await validateInstance(SCRATCH, "widgets/forbidden-picky.html", forbidden)))
```

Run it:

```bash
cd "$V4"
node verify-tmp-2.mjs "$SCRATCH"
```

Expected: `good-thing` prints `{"ok":true,"errors":[]}`; `bad-thing` prints `ok:false` with a `missing or empty <widget-name>` error; `forbidden-picky` prints `ok:false` with a `may not contain "forbidden"` error — matching Step 6 exactly, confirming the single-instance path (what `run.ts`'s `add`/`update` actually call) behaves identically to the whole-corpus path.

- [ ] **Step 8: Clean up the scratch fixture and the verification script**

```bash
rm -rf "$SCRATCH"
rm "$V4/verify-tmp-2.mjs"
```

- [ ] **Step 9: Commit**

```bash
cd experiments/v4
git add src/utils.ts src/validate.ts
git commit -m "experiment(v4): fall back to the generic validator, schema-first

utils.ts's validateInstance and validate.ts's per-instance check loop
both now run the generic attribute-driven check (template.template.html)
first, and layer any type's own hand-written data-validates script on
top when one still exists -- a node is valid only if both pass. A type
with no hand-written script validates through the generic path alone
instead of failing with 'no template found'. Verified against a scratch
widget fixture with three cases: generic-only, hand-written-only-catches-
it, and generic-catches-it-even-though-a-hand-written-script-exists.
Real repo behavior is unchanged -- every existing type still has its
validator and no template yet has the new attributes; that's Tasks 3-4."
```

---

### Task 3: Migrate `knowledge.template.html` — all six types

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html`

**Interfaces:**
- Consumes: the crawler fallback from Task 2 (must already be in place — without it, deleting these six scripts would make every real `knowledge-*` node fail whole-corpus validation the moment this task's `<template>` attributes aren't yet as strict as the deleted scripts, or worse, fail outright before this task adds the attributes at all).
- Produces: nothing later tasks consume — Task 4 is independent of this one.

- [ ] **Step 1: Add a short note to "Shared field vocabulary" pointing at the new mechanism**

Find:

```
<p>
  <code>knowledge-prompt</code> is optional even on <code>knowledge-goal</code>: CLAUDE.md's own rule is
  that a verbatim prompt belongs on root goals and major direction changes, not on every downstream node,
  so a <code>knowledge-goal</code> without one is valid, not incomplete.
</p>
```

Replace with:

```
<p>
  <code>knowledge-prompt</code> is optional even on <code>knowledge-goal</code>: CLAUDE.md's own rule is
  that a verbatim prompt belongs on root goals and major direction changes, not on every downstream node,
  so a <code>knowledge-goal</code> without one is valid, not incomplete.
</p>
<p>
  Both of these rules — and every other type's required/optional fields — are now expressed as
  <code>required</code>/<code>pattern</code>/<code>enum</code> attributes directly on each type's own
  <code>&lt;template&gt;</code> below, read generically by
  <a href="./template.template.html">template.template.html</a>'s validator, rather than as hand-written
  per-type JS.
</p>
```

- [ ] **Step 2: Migrate `knowledge-goal`**

Find:

```
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

Replace with:

```
<template id="knowledge-goal">
  <knowledge-goal>
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-status required enum="pending active completed rejected"></knowledge-status>
    <knowledge-prompt></knowledge-prompt>
    <knowledge-detail></knowledge-detail>
  </knowledge-goal>
</template>
```

Then find and delete this entire script block:

```
<script type="module" data-validates="#knowledge-goal">
  export function check(root) {
    const el = root.matches?.('knowledge-goal') ? root : root.querySelector('knowledge-goal')
    if (!el) return { ok: false, errors: ['missing <knowledge-goal> element'] }
    const errors = []
    for (const tag of ['knowledge-title', 'knowledge-confidence', 'knowledge-status']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    const status = el.querySelector('knowledge-status')?.textContent.trim()
    if (status && !['pending', 'active', 'completed', 'rejected'].includes(status)) {
      errors.push(`<knowledge-status> must be pending|active|completed|rejected, got "${status}"`)
    }
    for (const tag of ['knowledge-prompt', 'knowledge-detail']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-prompt', 'knowledge-detail']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-goal`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>
```

(delete it entirely — replace with nothing, leaving the `<pre><code>` example directly above it followed by the `<h3>knowledge-decision</h3>` heading below it)

- [ ] **Step 3: Migrate `knowledge-decision`**

Find:

```
<template id="knowledge-decision">
  <knowledge-decision>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-status></knowledge-status>
    <knowledge-detail></knowledge-detail>
  </knowledge-decision>
</template>
```

Replace with:

```
<template id="knowledge-decision">
  <knowledge-decision>
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-status required enum="pending active completed rejected"></knowledge-status>
    <knowledge-detail></knowledge-detail>
  </knowledge-decision>
</template>
```

Delete this entire script block:

```
<script type="module" data-validates="#knowledge-decision">
  export function check(root) {
    const el = root.matches?.('knowledge-decision') ? root : root.querySelector('knowledge-decision')
    if (!el) return { ok: false, errors: ['missing <knowledge-decision> element'] }
    const errors = []
    for (const tag of ['knowledge-title', 'knowledge-confidence', 'knowledge-status']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
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
```

- [ ] **Step 4: Migrate `knowledge-option`**

Find:

```
<template id="knowledge-option">
  <knowledge-option>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
  </knowledge-option>
</template>
```

Replace with:

```
<template id="knowledge-option">
  <knowledge-option>
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
  </knowledge-option>
</template>
```

Delete this entire script block:

```
<script type="module" data-validates="#knowledge-option">
  export function check(root) {
    const el = root.matches?.('knowledge-option') ? root : root.querySelector('knowledge-option')
    if (!el) return { ok: false, errors: ['missing <knowledge-option> element'] }
    const errors = []
    for (const tag of ['knowledge-title', 'knowledge-confidence']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }
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
```

- [ ] **Step 5: Migrate `knowledge-action`**

Find:

```
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

Replace with:

```
<template id="knowledge-action">
  <knowledge-action>
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-status required enum="pending active completed rejected"></knowledge-status>
    <knowledge-detail></knowledge-detail>
    <knowledge-commit></knowledge-commit>
    <knowledge-files></knowledge-files>
    <knowledge-branch></knowledge-branch>
  </knowledge-action>
</template>
```

Delete this entire script block:

```
<script type="module" data-validates="#knowledge-action">
  export function check(root) {
    const el = root.matches?.('knowledge-action') ? root : root.querySelector('knowledge-action')
    if (!el) return { ok: false, errors: ['missing <knowledge-action> element'] }
    const errors = []
    for (const tag of ['knowledge-title', 'knowledge-confidence', 'knowledge-status']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    const status = el.querySelector('knowledge-status')?.textContent.trim()
    if (status && !['pending', 'active', 'completed', 'rejected'].includes(status)) {
      errors.push(`<knowledge-status> must be pending|active|completed|rejected, got "${status}"`)
    }
    for (const tag of ['knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-action`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>
```

- [ ] **Step 6: Migrate `knowledge-outcome`**

Find:

```
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

Replace with:

```
<template id="knowledge-outcome">
  <knowledge-outcome>
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
    <knowledge-commit></knowledge-commit>
    <knowledge-files></knowledge-files>
    <knowledge-branch></knowledge-branch>
  </knowledge-outcome>
</template>
```

Delete this entire script block:

```
<script type="module" data-validates="#knowledge-outcome">
  export function check(root) {
    const el = root.matches?.('knowledge-outcome') ? root : root.querySelector('knowledge-outcome')
    if (!el) return { ok: false, errors: ['missing <knowledge-outcome> element'] }
    const errors = []
    for (const tag of ['knowledge-title', 'knowledge-confidence']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    for (const tag of ['knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-detail', 'knowledge-commit', 'knowledge-files', 'knowledge-branch']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-outcome`)
    }
    return { ok: errors.length === 0, errors }
  }
</script>
```

- [ ] **Step 7: Migrate `knowledge-observation`**

Find:

```
<template id="knowledge-observation">
  <knowledge-observation>
    <knowledge-title></knowledge-title>
    <knowledge-confidence></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
  </knowledge-observation>
</template>
```

Replace with:

```
<template id="knowledge-observation">
  <knowledge-observation>
    <knowledge-title required></knowledge-title>
    <knowledge-confidence required pattern="^(0|[1-9][0-9]?|100)$"></knowledge-confidence>
    <knowledge-detail></knowledge-detail>
  </knowledge-observation>
</template>
```

Delete this entire script block:

```
<script type="module" data-validates="#knowledge-observation">
  export function check(root) {
    const el = root.matches?.('knowledge-observation') ? root : root.querySelector('knowledge-observation')
    if (!el) return { ok: false, errors: ['missing <knowledge-observation> element'] }
    const errors = []
    for (const tag of ['knowledge-title', 'knowledge-confidence']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }
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
    return { ok: errors.length === 0, errors }
  }
</script>
```

- [ ] **Step 8: Verify the real repo still validates clean**

```bash
cd experiments/v4
pnpm validate
```

Expected: same `N checked, 0 fail` count as at the end of Task 2 — every real `knowledge-*` node's actual content already satisfies these rules (that's what the old hand-written validators were already enforcing), so nothing should newly fail.

- [ ] **Step 9: Verify rejections still work, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
V4="$(pwd)/experiments/v4"
SCRATCH=$(mktemp -d)
cp -r "$V4/docs" "$SCRATCH/docs"
```

Missing required field:

```bash
cat > "$SCRATCH/docs/knowledge/scratch-bad-goal.goal.html" << 'EOF'
<!DOCTYPE html><html><body>
<knowledge-goal data-conforms-to="../templates/knowledge.template.html#knowledge-goal">
  <knowledge-confidence>50</knowledge-confidence>
  <knowledge-status>active</knowledge-status>
</knowledge-goal>
</body></html>
EOF
node "$V4/src/validate.ts" "$SCRATCH/docs" 2>&1 | grep -A1 "scratch-bad-goal"
```

Expected: a `FAIL` line for `scratch-bad-goal.goal.html` with `missing or empty <knowledge-title>`.

Unexpected field:

```bash
cat > "$SCRATCH/docs/knowledge/scratch-bad-option.option.html" << 'EOF'
<!DOCTYPE html><html><body>
<knowledge-option data-conforms-to="../templates/knowledge.template.html#knowledge-option">
  <knowledge-title>t</knowledge-title>
  <knowledge-confidence>50</knowledge-confidence>
  <knowledge-status>active</knowledge-status>
</knowledge-option>
</body></html>
EOF
node "$V4/src/validate.ts" "$SCRATCH/docs" 2>&1 | grep -A1 "scratch-bad-option"
```

Expected: a `FAIL` line for `scratch-bad-option.option.html` with `unexpected <knowledge-status> on knowledge-option` (options never had a status field).

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 10: Commit**

```bash
cd experiments/v4
git add docs/templates/knowledge.template.html
git commit -m "experiment(v4): migrate knowledge.template.html's six types to the generic schema

Every knowledge-* type's <template> now carries required/pattern/enum
attributes expressing exactly what its hand-written check() function
used to encode in JS, and all six check() functions are deleted --
validation now runs entirely through template.template.html's generic
validator (Task 2). Confidence's pattern (^(0|[1-9][0-9]?|100)\$) is
stricter than the old ^\d+\$-plus-range-check (no leading zeros), but
every confidence value in the real corpus already matches it. pnpm
validate passes at the same count as before; a scratch copy confirms
both a missing-required-field and an unexpected-field case are still
rejected the same way."
```

---

### Task 4: Migrate `spec.template.html`, final verification

**Files:**
- Modify: `experiments/v4/docs/templates/spec.template.html`

**Interfaces:**
- Consumes: the crawler fallback from Task 2.
- Produces: nothing — this is the last task.

- [ ] **Step 1: Migrate `spec-doc`**

Find:

```
<template id="spec-doc">
  <spec-doc>
    <spec-title></spec-title>
    <spec-status></spec-status>
    <spec-date></spec-date>
    <spec-problem></spec-problem>
    <spec-design></spec-design>
    <spec-out-of-scope></spec-out-of-scope>
    <spec-open-questions></spec-open-questions>
  </spec-doc>
</template>
```

Replace with:

```
<template id="spec-doc">
  <spec-doc>
    <spec-title required></spec-title>
    <spec-status required enum="draft approved implemented"></spec-status>
    <spec-date required></spec-date>
    <spec-problem required></spec-problem>
    <spec-design required></spec-design>
    <spec-out-of-scope></spec-out-of-scope>
    <spec-open-questions></spec-open-questions>
  </spec-doc>
</template>
```

Delete this entire script block:

```
<script type="module" data-validates="#spec-doc">
  export function check(root) {
    const el = root.matches?.('spec-doc') ? root : root.querySelector('spec-doc')
    if (!el) return { ok: false, errors: ['missing <spec-doc> element'] }

    const errors = []
    for (const tag of ['spec-title', 'spec-status', 'spec-date', 'spec-problem', 'spec-design']) {
      const node = el.querySelector(tag)
      if (!node || !node.textContent.trim()) errors.push(`missing or empty <${tag}>`)
    }

    const statusValue = el.querySelector('spec-status')?.textContent.trim()
    if (statusValue && !['draft', 'approved', 'implemented'].includes(statusValue)) {
      errors.push(`<spec-status> must be draft|approved|implemented, got "${statusValue}"`)
    }

    for (const tag of ['spec-out-of-scope', 'spec-open-questions']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }

    return { ok: errors.length === 0, errors }
  }
</script>
```

- [ ] **Step 2: Verify the real repo still validates clean**

```bash
cd experiments/v4
pnpm validate
```

Expected: same `N checked, 0 fail` count as at the end of Task 3.

- [ ] **Step 3: Verify a rejection still works, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
V4="$(pwd)/experiments/v4"
SCRATCH=$(mktemp -d)
cp -r "$V4/docs" "$SCRATCH/docs"

cat > "$SCRATCH/docs/specs/2026-01-01-scratch-bad-spec.spec.html" << 'EOF'
<!DOCTYPE html><html><body>
<spec-doc data-conforms-to="../templates/spec.template.html#spec-doc">
  <spec-title>t</spec-title>
  <spec-status>bogus</spec-status>
  <spec-date>2026-01-01</spec-date>
  <spec-problem>p</spec-problem>
  <spec-design>d</spec-design>
</spec-doc>
</body></html>
EOF
node "$V4/src/validate.ts" "$SCRATCH/docs" 2>&1 | grep -A1 "scratch-bad-spec"
rm -rf "$SCRATCH"
```

Expected: a `FAIL` line for `scratch-bad-spec.spec.html` with `<spec-status> must be draft|approved|implemented, got "bogus"`.

- [ ] **Step 4: Full-repo sanity pass**

```bash
cd experiments/v4
pnpm validate
```

Expected: `N checked, 0 fail`, matching Step 2 — no drift from the start of this task.

- [ ] **Step 5: Commit**

```bash
git add docs/templates/spec.template.html
git commit -m "experiment(v4): migrate spec.template.html's spec-doc to the generic schema

spec-doc's <template> now carries required/enum attributes matching
its hand-written check() function exactly, which is deleted --
validation runs entirely through template.template.html's generic
validator. pnpm validate passes at the same count as before this
plan started; a scratch copy confirms a bad spec-status value is
still rejected the same way."
```

- [ ] **Step 6: Log the outcome in the knowledge graph**

```bash
pnpm --filter @mycelium/v4 mycelium knowledge add outcome \
  --title "template.template.html shipped: all seven hand-written validators replaced by one generic, attribute-driven check" \
  --confidence 85 \
  --commit "$(git log -1 --format=%h)" \
  --branch main \
  --file template-schema-shipped
```

Then link it back to the decision chain:

```bash
cd docs/knowledge
pnpm --filter @mycelium/v4 mycelium knowledge link \
  2026-07-25-template-schema-shipped.outcome.html \
  2026-07-25-schema-first-then-optional-validator-function.decision.html \
  --rel leads_to --label "the decision this outcome resolves"
cd ../..
pnpm validate
```

Expected: `pnpm validate`'s final count includes the new outcome node, `0 fail`.

---

## Self-Review Notes

- **Spec coverage:** "Schema lives on the existing `<template>`" → Task 3/4's attribute additions. "template.template.html: vocabulary + one generic validator, not a new instantiable type" → Task 1 (no `<template id>` of its own, no live-demo, no dedicated CSS — called out explicitly in Global Constraints). "Full replace: the seven hand-written validators are deleted" → Tasks 3 (six) and 4 (one). "This is a real behavior change to the crawler... a fallback path" → Task 2, verified against both `validate.ts`'s whole-corpus pass and `utils.ts`'s `validateInstance`. Schema-first/custom-additive ordering → Task 2 Step 5-7's `widget-picky` case, specifically designed so the generic check catches something the custom script doesn't (empty field) and vice versa (the forbidden-substring case), proving neither is skipped in the other's favor. Out-of-scope items (overview command, reverse-DNS filenames, self-conformance) → correctly absent from every task.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable; every verification step names an exact expected output.
- **Type consistency:** `validateFromTemplate(templateEl, instanceRoot)` (Task 1) is called identically in Task 2's `loadGenericValidator`-returned closure (`genericCheck(templateEl, instanceEl)` in `utils.ts`, `genericCheck(template.element, instance.element)` in `validate.ts`) — same two-argument shape, same `{ ok, errors }` return shape `CheckResult`/the existing `{ ok: boolean; errors: string[] }` convention already used throughout. `TemplateInfo.element` (Task 2) is populated at the exact point `TemplateInfo` is constructed in `discoverTemplatesAndAudits`, so it's always present by the time Task 2's per-instance loop reads it — never optional, never a separate lookup.
- **Task ordering:** Task 2 must land before Tasks 3/4 — deleting a `data-validates` script before the crawler has a fallback would make every real node of that type fail with "no template found" the instant it's deleted. Tasks 3 and 4 are independent of each other (different files, same file family convention) but both depend on Task 2.
