# Spec Authoring Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `spec.template.html` its own `add`/`update` authoring commands, closing the last hand-authoring gap this project's `CLAUDE.md` still names. Along the way, extend the date-prefixed filename convention specs already have (`<date>-<topic>.spec.html`) to `knowledge.template.html`'s `add` too, so new knowledge nodes get it going forward.

**Architecture:** Three sequential tasks. Task 1 adds `cli.parseHTML` (needed by Task 2) and the date-prefix change to `knowledge.template.html`'s `add` — both small, independent of Task 2's larger work, but Task 2 depends on `cli.parseHTML` existing. Task 2 builds `spec.template.html`'s entire `<script type="mycelium/command">` block from scratch: a local `requireArgs`, a local `todayDate()`, a shared `extractSections` helper, and `add`/`update`. Task 3 updates the one passage in `CLAUDE.md` that becomes factually wrong once Task 2 ships.

**Tech Stack:** Node ≥24, TypeScript via native type stripping, happy-dom (already a dependency). No new dependencies. No test framework — verification is running the tool directly against scratch copies.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html` — read it before starting.
- No new dependencies.
- `spec.template.html` gets `add`/`update` only — no `link` (cross-references live inside rich-field markup, not as top-level children) and no `list` (deferred, not forgotten — do not build one).
- No `--date` flag anywhere, on either family. `add` computes today's local date itself via a small `todayDate()` helper, duplicated per family's own command script (never shared via `utils.ts` — a data: URL-loaded command script can't do a relative import, and each family's script is meant to be self-contained, same reasoning `requireArgs` already follows).
- The date-prefix change to `knowledge.template.html`'s `add` is **not retroactive** — existing `knowledge/*.html` files keep their current names untouched. Only new files `add` creates from here on get the prefix.
- `--body`'s four possible tags (`spec-problem`, `spec-design`, `spec-out-of-scope`, `spec-open-questions`) are parsed by tag name from one blob, not one flag per tag. A tag absent from the blob leaves that field untouched (on `update`) or simply unset (on `add`); a tag present but empty removes/omits it; a tag with real content upserts/sets it.
- Run all `pnpm`/`node` commands from `experiments/v4/`, except scratch-copy verification steps, which use a `(cd "$SCRATCH" && node "$RUN" …)` subshell — `run.ts` always resolves `docs/` relative to the current working directory, with no directory argument, unlike `validate.ts`.
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go.

---

### Task 1: `cli.parseHTML`, and date-prefixed filenames for `knowledge.template.html`'s `add`

**Files:**
- Modify: `experiments/v4/src/run.ts`
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (`add` only)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `cli.parseHTML(html: string): { document: Document }`, available to every command via `CommandContext`. Task 2's `spec.template.html` commands depend on this existing.

- [ ] **Step 1: Add `parseHTML` to the `Cli` interface and its construction**

In `experiments/v4/src/run.ts`, find:

```ts
import { parseHTML, walkHtmlFiles, validateInstance, readStdin, loadModule } from "./utils.ts"

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>

interface Cli {
  validate: Validate
  readStdin: () => Promise<string>
}
```

Replace with:

```ts
import { parseHTML, walkHtmlFiles, validateInstance, readStdin, loadModule } from "./utils.ts"

type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>

interface Cli {
  validate: Validate
  readStdin: () => Promise<string>
  parseHTML: (html: string) => { document: Document }
}
```

- [ ] **Step 2: Wire it into the `cli` object built in `main()`**

Find:

```ts
  const validate: Validate = (root, instancePath) => validateInstance(docsDir, instancePath, root)
  const cli: Cli = { validate, readStdin }
```

Replace with:

```ts
  const validate: Validate = (root, instancePath) => validateInstance(docsDir, instancePath, root)
  const cli: Cli = { validate, readStdin, parseHTML }
```

- [ ] **Step 3: Add `todayDate()` and the date-prefix to `knowledge.template.html`'s `add`**

In `experiments/v4/docs/templates/knowledge.template.html`, find:

```
  // Throws a clean, specific error for the handful of arguments no
  // validator can ever catch (which file to write, which file to open,
  // whether --rel was given at all) — everything else is left to each
  // type's own knowledge-validates script, run via `validate` below.
  function requireArgs(...checks) {
    for (const [value, label] of checks) {
      if (value === undefined) throw new Error(`missing required argument: ${label}`)
    }
  }
```

Replace with:

```
  // Throws a clean, specific error for the handful of arguments no
  // validator can ever catch (which file to write, which file to open,
  // whether --rel was given at all) — everything else is left to each
  // type's own knowledge-validates script, run via `validate` below.
  function requireArgs(...checks) {
    for (const [value, label] of checks) {
      if (value === undefined) throw new Error(`missing required argument: ${label}`)
    }
  }

  // Local to this file on purpose, not shared with spec.template.html's
  // own copy — see docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html.
  function todayDate() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
```

Find:

```
  export async function add({ fs, args, cli }) {
    requireArgs([args.file, '--file'])
    const detail = args.detail === '-' ? await cli.readStdin() : args.detail
    const type = args._[0]
    const path = `knowledge/${args.file}.${type}.html`
```

Replace with:

```
  export async function add({ fs, args, cli }) {
    requireArgs([args.file, '--file'])
    const detail = args.detail === '-' ? await cli.readStdin() : args.detail
    const type = args._[0]
    const path = `knowledge/${todayDate()}-${args.file}.${type}.html`
```

Also update `add`'s doc comment. Find:

```
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

Replace with:

```
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
   * knowledge/<today's-date>-<slug>.<type>.html — the date isn't a flag,
   * it's today's actual date, matching the convention spec.template.html's
   * own add already uses. --detail is free-form markup (real HTML,
   * including <script> — no tag restriction); pass --detail - to read it
   * from stdin instead of the command line, for anything more than a
   * one-line value. The built node is validated against its own type's
   * validator before being written — an unrecognized <type>, a missing
   * required field, or a field the type doesn't allow is rejected and
   * nothing is written.
   */
```

- [ ] **Step 4: Verify `cli.parseHTML` is real, and existing commands still work**

```bash
cd experiments/v4
node -e "import('./src/utils.ts').then(m => console.log(typeof m.parseHTML))"
```

Expected: `function` — confirms `parseHTML` is exported from `utils.ts` (unchanged from before, just confirming the import Step 1 relies on is real).

```bash
pnpm mycelium knowledge list nodes | head -3
```

Expected: same kind of output as always — proves adding a key to `Cli`/`cli` doesn't break anything that doesn't use it.

- [ ] **Step 5: Verify the date-prefix, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" knowledge add observation --title "date prefix test" --confidence 60 --file date-prefix-test)
ls "$SCRATCH/docs/knowledge" | grep date-prefix-test
node "$VALIDATE" "$SCRATCH/docs"
rm -rf "$SCRATCH"
```

Expected: `wrote    knowledge/<today's-date>-date-prefix-test.observation.html`; the `ls | grep` shows a filename starting with today's actual date (e.g. `2026-07-24-date-prefix-test.observation.html`); `0 fail`.

- [ ] **Step 6: Verify the real repo is unaffected — existing filenames untouched**

```bash
cd experiments/v4
pnpm validate
git status --short docs/knowledge/ | grep -v '^??'
```

Expected: same count as before this task, `0 fail`; the `git status` filter shows no output (no existing file was modified — this task only changes what `add` does for *new* files).

- [ ] **Step 7: Commit**

```bash
git add experiments/v4/src/run.ts experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): cli.parseHTML, date-prefixed filenames for knowledge's add

parseHTML joins validate/readStdin as a fourth capability every
command receives via cli — needed by spec.template.html's upcoming
add/update to parse --body's blob apart by tag name, not used by any
existing knowledge command yet. Separately, knowledge's add now
prefixes new filenames with today's date (knowledge/<date>-<slug>.
<type>.html), the same convention spec docs already have — not a new
field, not retroactive, purely how add names files going forward.
todayDate() is local to this file, not shared with spec.template.
html's own copy."
```

---

### Task 2: `spec.template.html`'s `add`/`update`

**Files:**
- Modify: `experiments/v4/docs/templates/spec.template.html`

**Interfaces:**
- Consumes: `cli.parseHTML`/`cli.validate`/`cli.readStdin` from Task 1's `CommandContext` shape (already available to every command; Task 1 only added the `parseHTML` piece).
- Produces: nothing later tasks consume directly, though Task 3's `CLAUDE.md` update describes what this task builds.

- [ ] **Step 1: Insert the "Authoring commands" section**

In `experiments/v4/docs/templates/spec.template.html`, find:

```
    out.className = result.ok ? 'pass' : 'fail'
  </script>
</div>

<h2>Conformance</h2>
```

Replace with:

```
    out.className = result.ok ? 'pass' : 'fail'
  </script>
</div>

<h2>Authoring commands</h2>
<p>
  <code>add</code> and <code>update</code>, declared once for this template &mdash; same
  <code>type="mycelium/command"</code> convention
  <a href="./knowledge.template.html">knowledge.template.html</a> already uses, and the same reasons: never
  run in a browser (no live demo below, unlike the <code>data-validates</code> script above), and each
  command's own <code>/** &hellip; */</code> comment is its only documentation, so
  <code>mycelium run spec --help</code> and the usage shown here can never drift apart. No
  <code>link</code>: every cross-reference a spec makes already lives inside one of its rich fields' own
  markup (a <code>&lt;a data-rel&gt;</code> written directly into <code>--body</code>'s content), so there's
  no separate "attach an edge" operation the way <code>knowledge-*</code> needs one. No <code>list</code>,
  yet: see <a href="../specs/2026-07-24-mycelium-spec-authoring-commands.spec.html">the design spec</a> for
  why that's deferred, not forgotten.
</p>
<script type="mycelium/command">
  // Local to this file on purpose, not imported from knowledge.template.html
  // or shared via utils.ts — a data: URL-loaded command script can't do a
  // relative import anyway (no hierarchical base to resolve against), and
  // each family's command script is meant to be self-contained. See
  // docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html.
  function requireArgs(...checks) {
    for (const [value, label] of checks) {
      if (value === undefined) throw new Error(`missing required argument: ${label}`)
    }
  }

  function todayDate() {
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  const BODY_TAGS = ['spec-problem', 'spec-design', 'spec-out-of-scope', 'spec-open-questions']

  // Parses --body's resolved value once and pulls out whichever of the four
  // rich-content tags are present, keyed by tag name. A tag not mentioned
  // in the blob simply isn't a key in the result — add/update both treat
  // that as "nothing said about this field," never as "clear it."
  function extractSections(cli, bodyMarkup) {
    const { document } = cli.parseHTML(`<div>${bodyMarkup}</div>`)
    const wrapper = document.querySelector('div')
    const sections = {}
    for (const tag of BODY_TAGS) {
      const el = wrapper.querySelector(tag)
      if (el) sections[tag] = el.innerHTML
    }
    return sections
  }

  /**
   * Create a new spec-doc file.
   *
   *   mycelium run spec add --title "…" --file <topic>
   *     [--status draft|approved|implemented] [--body "…" | --body -]
   *
   * --file is required and becomes docs/specs/<today's-date>-<topic>.spec.html
   * — the date isn't a flag, it's today's actual date, used for both the
   * filename and the <spec-date> field so they can never drift apart.
   * --status defaults to "draft" if omitted. --body is a blob of markup
   * using <spec-problem>/<spec-design>/<spec-out-of-scope>/<spec-open-questions>
   * as its own delimiters — pass --body - to read it from stdin instead of
   * the command line, for anything more than a trivial one-line value.
   * spec-problem and spec-design are both required by this template's own
   * validator, so a --body that omits either one is rejected the same way
   * a missing --title would be — nothing is written.
   */
  export async function add({ fs, args, cli }) {
    requireArgs([args.file, '--file'])
    const bodyMarkup = args.body === '-' ? await cli.readStdin() : args.body
    const sections = bodyMarkup ? extractSections(cli, bodyMarkup) : {}

    const date = todayDate()
    const path = `specs/${date}-${args.file}.spec.html`
    const doc = fs.create(path, `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<link rel="stylesheet" href="../theme.css">
<link rel="stylesheet" href="../templates/spec.template.css">
</head>
<body>

<spec-doc data-conforms-to="../templates/spec.template.html#spec-doc">
</spec-doc>

</body>
</html>
`)

    doc.querySelector('title').textContent = `Spec: ${args.title}`

    const root = doc.querySelector('spec-doc')
    const field = (tag, text) => {
      if (!text) return
      const el = doc.createElement(tag)
      el.textContent = text
      root.appendChild(el)
    }

    field('spec-title', args.title)
    field('spec-status', args.status ?? 'draft')
    field('spec-date', date)
    for (const tag of BODY_TAGS) {
      if (!sections[tag]) continue
      const el = doc.createElement(tag)
      el.innerHTML = sections[tag]
      root.appendChild(el)
    }

    const result = await cli.validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }

  /**
   * Update fields on an existing spec-doc file.
   *
   *   mycelium run spec update <file> [--title "…"]
   *     [--status draft|approved|implemented] [--body "…" | --body -]
   *
   * <file> is an existing docs/specs/<date>-<topic>.spec.html file.
   * --title/--status follow the usual rule: omitted leaves the field
   * untouched, any other value upserts it. --body applies that same rule
   * per tag found inside it, not per flag: a tag absent from --body's
   * content leaves that field untouched, a tag present but empty removes
   * the field, a tag with real content upserts it (overwrite if the field
   * already exists, append if not). spec-date is never touched by
   * update — only add sets it, once, at creation.
   */
  export async function update({ fs, args, cli }) {
    requireArgs([args._[0], '<file>'])
    const path = `specs/${args._[0]}`
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

    field('spec-title', args.title)
    field('spec-status', args.status)

    const bodyMarkup = args.body === '-' ? await cli.readStdin() : args.body
    if (bodyMarkup !== undefined) {
      const sections = extractSections(cli, bodyMarkup)
      for (const tag of BODY_TAGS) {
        if (!(tag in sections)) continue
        const content = sections[tag]
        const existing = root.querySelector(tag)
        if (!content.trim()) {
          existing?.remove()
        } else if (existing) {
          existing.innerHTML = content
        } else {
          const el = doc.createElement(tag)
          el.innerHTML = content
          root.appendChild(el)
        }
      }
    }

    const result = await cli.validate(root, path)
    if (!result.ok) throw new Error(result.errors.join('\n'))
  }
</script>

<h2>Conformance</h2>
```

- [ ] **Step 2: Verify `--help` discovers both commands**

```bash
cd experiments/v4
pnpm mycelium spec --help
```

Expected: lists `add` and `update` (not `link`, not `list`), each with its doc comment printed — proves `extractCommandDocs`/`printHelp` (unmodified, generic machinery) correctly discovers the new script's exports.

- [ ] **Step 3: Verify a full `add` with a literal `--body`, in a scratch copy**

```bash
cd /path/to/mycelium   # repo root
RUN="$(pwd)/experiments/v4/src/run.ts"
VALIDATE="$(pwd)/experiments/v4/src/validate.ts"
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"

(cd "$SCRATCH" && node "$RUN" spec add --title "scratch spec test" --file scratch-spec-test --body "<spec-problem><p>problem text</p></spec-problem><spec-design><p>design text</p></spec-design>")
TODAY=$(date +%Y-%m-%d)
ls "$SCRATCH/docs/specs" | grep "$TODAY-scratch-spec-test"
node "$VALIDATE" "$SCRATCH/docs"
```

Expected: `wrote    specs/<today>-scratch-spec-test.spec.html`; the `ls | grep` finds the file (proves the date prefix matches the actual date used); `0 fail`.

```bash
grep -c "spec-problem\|spec-design\|spec-status>draft\|spec-date>$TODAY" "$SCRATCH/docs/specs/$TODAY-scratch-spec-test.spec.html"
```

Expected: `4` — confirms `spec-problem`, `spec-design`, the default `draft` status, and `spec-date` matching the same date used in the filename are all present in the written file.

- [ ] **Step 4: Verify `--body -` (stdin) with real markup, in the same scratch copy**

```bash
(cd "$SCRATCH" && node "$RUN" spec add --title "stdin spec test" --file stdin-spec-test --body - <<'EOF'
<spec-problem>
  <p>Multi-paragraph problem statement.</p>
  <p>A second paragraph, with <code>inline code</code>.</p>
</spec-problem>
<spec-design>
  <p>The approach.</p>
  <pre><code>const x = 1</code></pre>
</spec-design>
<spec-out-of-scope>
  <ul><li>Not doing this other thing.</li></ul>
</spec-out-of-scope>
EOF
)
grep -c "Multi-paragraph\|inline code\|const x = 1\|Not doing this other thing" "$SCRATCH/docs/specs/$TODAY-stdin-spec-test.spec.html"
node "$(pwd)/experiments/v4/src/validate.ts" "$SCRATCH/docs" 2>&1 | tail -3
```

Expected: `wrote`; `grep -c` reports `4` (every fragment survived, unescaped — real `<pre><code>` and `<p>` tags, not `&lt;p&gt;`); `0 fail`. This is the concrete proof of the whole feature's motivation: three rich sections, one command, zero shell-escaping concerns.

- [ ] **Step 5: Verify `add` rejects a `--body` missing a required field, nothing written**

```bash
(cd "$SCRATCH" && node "$RUN" spec add --title "incomplete spec test" --file incomplete-spec-test --body "<spec-problem><p>only the problem, no design</p></spec-problem>" 2>&1)
echo "exit: $?"
ls "$SCRATCH/docs/specs" | grep incomplete-spec-test
```

Expected: error output contains `missing or empty <spec-design>`, `exit: 1`, and the final `ls | grep` prints nothing — no file was written.

- [ ] **Step 6: Verify `update` upserts, removes, and leaves fields alone correctly, per tag found**

```bash
FILE="$TODAY-scratch-spec-test.spec.html"
cp "$SCRATCH/docs/specs/$FILE" /tmp/spec-before.html

# Upsert spec-design, leave spec-problem untouched (not mentioned in --body)
(cd "$SCRATCH" && node "$RUN" spec update "$FILE" --body "<spec-design><p>replaced design text</p></spec-design>")
grep -c "replaced design text" "$SCRATCH/docs/specs/$FILE"
grep -c "problem text" "$SCRATCH/docs/specs/$FILE"

# Remove spec-design (present but empty)
(cd "$SCRATCH" && node "$RUN" spec update "$FILE" --status approved --body "<spec-design></spec-design>" 2>&1)
echo "exit: $?"
```

Expected: first `grep -c` reports `1` (design was replaced); second `grep -c` reports `1` (problem field, never mentioned in that `--body` call, is untouched). The second `update` call — which would remove `spec-design`, a required field — is expected to be REJECTED by `cli.validate()` (`missing or empty <spec-design>`), `exit: 1`, proving `update` can't be used to make a spec invalid either, same guarantee `add` has.

```bash
diff /tmp/spec-before.html "$SCRATCH/docs/specs/$FILE"
rm /tmp/spec-before.html
```

Expected: real differences (the design-text replacement from the first `update` call actually landed) — this `diff` is just confirming the file was genuinely touched once, not asserting no changes.

- [ ] **Step 7: Clean up, verify the real repo is unaffected**

```bash
rm -rf "$SCRATCH"
cd experiments/v4
pnpm validate
```

Expected: same count as before this task, `0 fail`.

- [ ] **Step 8: Commit**

```bash
git add experiments/v4/docs/templates/spec.template.html
git commit -m "experiment(v4): spec.template.html gets add and update

add/update, no link (cross-references live inside rich-field markup,
not as top-level children) and no list (deferred). No --date flag:
add computes today's date itself, used for both the filename prefix
and the required spec-date field, so they can't drift apart.
spec-problem/spec-design are both required and both rich content, so
add accepts a single --body blob (same -/stdin shape as knowledge's
--detail) using the field names themselves as delimiters, parsed and
distributed by tag name via the new cli.parseHTML. update applies its
usual omitted/empty/value convention per tag found in --body rather
than per flag. requireArgs/todayDate are local copies, not shared
with knowledge.template.html's own."
```

---

### Task 3: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: describes what Tasks 1-2 actually built — must land after them.
- Produces: nothing consumed elsewhere — this is the last task.

- [ ] **Step 1: Replace the stale "one real gap remains" passage**

In the repo-root `CLAUDE.md`, find:

```
This replaces the Write/Read+Edit dance for every node/edge `knowledge-*`
covers — no file content passes through the model doing the logging, same
as `deciduous add`/`deciduous link` never did. `add` creates a node,
`link` connects two, `update` fills in or clears a field on one that
already exists (e.g. adding `<knowledge-commit>` to an action node once
its commit exists) — the field-update gap this section used to name here
is closed. One real gap remains, not silently papered over: it only
covers the `knowledge-*` family — `spec.template.html` has no
`type="mycelium/command"` script yet, so spec docs still need
hand-authoring. Copying the closest existing spec under
`experiments/v4/docs/specs/` as a starting point is still the fastest
correct way to do that. Full design:
`experiments/v4/docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`
(commands) and
`experiments/v4/docs/specs/2026-07-23-mycelium-update-command.spec.html`
(`update`, and the closed-schema validator check that backs it).
```

Replace with:

```
This replaces the Write/Read+Edit dance for every node/edge `knowledge-*`
covers — no file content passes through the model doing the logging, same
as `deciduous add`/`deciduous link` never did. `add` creates a node,
`link` connects two, `update` fills in or clears a field on one that
already exists (e.g. adding `<knowledge-commit>` to an action node once
its commit exists) — the field-update gap this section used to name here
is closed. Spec docs get the same treatment now too, via
`spec.template.html`'s own `add`/`update` — no `link` (a spec's
cross-references live inside its own rich-field markup, not as separate
edges) and no `list` yet (deferred, not forgotten):

```bash
pnpm --filter @mycelium/v4 mycelium spec add --title "…" --file <topic> [--status draft|approved|implemented] --body "…"
pnpm --filter @mycelium/v4 mycelium spec update <file> [--title "…"] [--status S] [--body "…"]
```
No hand-authoring gap remains for either family. Full design:
`experiments/v4/docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`
(commands),
`experiments/v4/docs/specs/2026-07-23-mycelium-update-command.spec.html`
(`update`, and the closed-schema validator check that backs it), and
`experiments/v4/docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html`
(spec's own `add`/`update`, its single `--body` flag covering multiple
rich fields at once, and the date-prefixed-filename convention both
families now share).
```

- [ ] **Step 2: Verify**

```bash
grep -n "spec docs still need\|hand-authoring" CLAUDE.md
```

Expected: no output — the stale claim is gone (the replacement text says "no hand-authoring gap remains," not "still need hand-authoring").

```bash
cd experiments/v4
pnpm validate
```

Expected: same count as before this task, `0 fail` — `CLAUDE.md` isn't part of the graph, this just confirms nothing else broke.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for spec's new add/update commands

The 'one real gap remains' passage was accurate when written -- as of
this commit it no longer is. spec.template.html now has its own
add/update, same as knowledge.template.html always has; the passage
now documents both, and points at the new spec doc for the design
reasoning (single --body flag, date-prefix convention) instead of
just naming the gap."
```

---

## Self-Review Notes

- **Spec coverage:** "add and update only" → Task 2's inserted prose + script (no `link`/`list` exports). "Filenames: no --date flag anywhere" → Task 1 (knowledge) + Task 2 (spec), both using `todayDate()`. "knowledge-* filenames get the same date prefix, separately" → Task 1. "Duplicated, not shared" → both tasks define their own `todayDate()`/`requireArgs`, verified as separate local copies, not an import. "Rich content: one --body flag" → Task 2's `extractSections`/`add`/`update`. "update: the existing per-field convention, applied per tag found" → Task 2's `update`. All four `<spec-out-of-scope>` items (no list, no retroactive rename, no per-field flags, no --date override) correctly appear nowhere as tasks.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable; every verification step names an exact expected output.
- **Type consistency:** `Cli`'s `parseHTML` (Task 1) matches `utils.ts`'s actual exported signature (`(html: string) => { document: Document }`), and is consumed identically by `spec.template.html`'s `extractSections` (Task 2), which is the only caller. `BODY_TAGS` is defined once and referenced identically by both `add` and `update` within Task 2 — no risk of the two functions' tag lists drifting apart, since there's only one array both read from.
- **Cross-task consistency:** Task 2's `add`/`update` both call `cli.validate(root, path)` exactly the way `knowledge.template.html`'s `add`/`update` already do (established in the earlier CLI-validation plan) — same abort-on-invalid guarantee, same reliance on `commit()` only running after a successful return, no new mechanism invented for this family.
- **Ordering:** strictly sequential. Task 2 cannot start until Task 1's `cli.parseHTML` exists. Task 3 describes the end state of Task 2, so it must run last. Task 1's two halves (parseHTML, knowledge's date-prefix) are otherwise independent of each other but bundled into one task since both are small and touch the same two files.
