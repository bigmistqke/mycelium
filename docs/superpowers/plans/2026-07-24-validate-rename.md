# Validate Rename & Audit-Scoping Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `crawl.ts`'s two audits so they stop treating `knowledge.template.html`'s own self-test sample fixtures as part of the real graph (eliminating two "failures" that show up on every single run), make its output quiet-by-default and colorized instead of dumping a PASS line per instance plus raw JSON, and rename the whole thing from `crawl`/`crawl.ts` to `validate`/`validate.ts`.

**Architecture:** All three pieces live in one file, `experiments/v4/src/crawl.ts` (renamed to `validate.ts` in the last task). (1) Compute `templatesDir` once and filter it out of the `documents` array handed to every `data-audits` script — per-instance validation is untouched. (2) Replace the verbose per-instance PASS logging and the separate `validators: N pass, M fail` line with one colorized summary (`N checked, M fail`, via `node:util`'s built-in `styleText`) plus restructured (non-JSON) failure detail for anything that actually failed. (3) `git mv` the file, update the `package.json` script, and fix every *living* reference to the old name (README.md, CLAUDE.md, and two source-comment mentions) — leaving every reference inside existing frozen spec docs, past plans, and `knowledge/*.html` nodes untouched, since those are historical record.

**Tech Stack:** Node ≥24 (`node:util`'s `styleText`, stable, no dependency). No test framework — verification is running the tool directly and inspecting output, same as every prior task in this project.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-24-mycelium-validate-rename.spec.html` — read it before starting.
- No new dependencies.
- Per-instance validation (`data-validates`) keeps including everything under `docs/`, samples included — only audit input changes.
- No `--verbose` flag or other mode switch — quiet-by-default is the only mode.
- The rename in Task 3 only touches *living* documentation and source comments (README.md, CLAUDE.md, `run.ts`'s header comment, one line in `knowledge.template.html`'s live-demo prose) plus `package.json` and the file itself. Every `crawl`/`crawl.ts` mention inside `experiments/v4/docs/specs/*.html`, `docs/superpowers/plans/*.md`, and `experiments/v4/docs/knowledge/*.html` stays exactly as-is — these are historical record of what was literally true when written, not living instructions.
- The tool's own conceptual self-description ("the mycelium v4 crawler" in its header comment, "the crawler" as prose elsewhere) is describing what it *does* (walks the tree), not naming an artifact — it does not need to change just because the file/command name does.
- Run all `pnpm`/`node` commands from `experiments/v4/` unless a step says otherwise.
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go, the same way prior work in this repo did.

---

### Task 1: Exclude `docs/templates/` from audit input

**Files:**
- Modify: `experiments/v4/src/crawl.ts` (the `main()` function only)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing later tasks call directly — Task 2 rewrites the same function further, and should build on this task's `auditDocuments` filtering rather than reverting it.

- [ ] **Step 1: Add the `sep` import**

In `experiments/v4/src/crawl.ts`, find:

```ts
import { dirname, resolve as resolvePath } from "node:path"
```

Replace with:

```ts
import { dirname, resolve as resolvePath, sep } from "node:path"
```

- [ ] **Step 2: Compute and use `auditDocuments`**

Find, in `main()`:

```ts
async function main() {
  const dir = resolvePath(process.argv[2] ?? "./docs")
  const documents = parseAll(dir)
  const { templates, audits } = discoverTemplatesAndAudits(documents)
  const instances = discoverInstances(documents)

  console.log(`${documents.length} documents, ${templates.size} templates, ${instances.length} instances, ${audits.length} audits\n`)
```

Replace with:

```ts
async function main() {
  const dir = resolvePath(process.argv[2] ?? "./docs")
  const documents = parseAll(dir)
  const { templates, audits } = discoverTemplatesAndAudits(documents)
  const instances = discoverInstances(documents)
  // Audits answer whole-graph questions ("is every outcome linked to?"); the
  // template's own live-demo sample instances aren't real graph data, just a
  // documentation fixture, so they'd corrupt that answer if left in. Per-
  // instance validation (below) is unaffected — it validates one element in
  // isolation, so a sample instance in the mix is harmless there.
  const templatesDir = resolvePath(dir, "templates") + sep
  const auditDocuments = documents.filter((d) => !d.path.startsWith(templatesDir))

  console.log(`${documents.length} documents, ${templates.size} templates, ${instances.length} instances, ${audits.length} audits\n`)
```

Then find, later in the same function, inside the audits loop:

```ts
  for (const audit of audits) {
    const label = `${audit.name}  (${relative(dir, audit.file)}${audit.touches ? `, touches: ${audit.touches}` : ""})`
    try {
      const check = await loadCheck(audit.scriptSource)
      const result = (await check(documents)) as CheckResult
```

Replace `check(documents)` with `check(auditDocuments)`:

```ts
  for (const audit of audits) {
    const label = `${audit.name}  (${relative(dir, audit.file)}${audit.touches ? `, touches: ${audit.touches}` : ""})`
    try {
      const check = await loadCheck(audit.scriptSource)
      const result = (await check(auditDocuments)) as CheckResult
```

- [ ] **Step 3: Verify the two known audits now pass**

```bash
cd experiments/v4
pnpm crawl
```

Expected: `validators: N pass, 0 fail` with the same `N` as before this change (per-instance validation is untouched — same instances, including the six samples, still get validated). Both audits now report **PASS**, not FAIL:

```
PASS  orphans-except-goal  (templates/knowledge.template.html, touches: ...)
      {"ok":true,"violations":[]}
PASS  dangling-outcome  (templates/knowledge.template.html, touches: ...)
      {"ok":true,"violations":[]}
```

This is the concrete proof: the exact same two audits, against the exact same sample markup, now correctly report no real-graph problem — because the sample markup is no longer in the set they're checking.

- [ ] **Step 4: Verify a real orphan is still caught, in an isolated scratch copy**

```bash
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cat > "$SCRATCH/docs/knowledge/real-orphan-test.observation.html" <<'EOF'
<!DOCTYPE html>
<html lang="en"><head><title>Observation: real orphan</title></head><body>
<knowledge-observation data-conforms-to="../templates/knowledge.template.html#knowledge-observation">
<knowledge-title>deliberately unconnected, for a real-orphan test</knowledge-title>
<knowledge-confidence>50</knowledge-confidence>
</knowledge-observation>
</body></html>
EOF
node experiments/v4/src/crawl.ts "$SCRATCH/docs" 2>&1 | grep -A1 "orphans-except-goal"
rm -rf "$SCRATCH"
```

Expected: `FAIL  orphans-except-goal ...` with `"violations":["real-orphan-test.observation.html"]` (or the file's resolved path/id) in the JSON — a genuine real-graph orphan, outside `docs/templates/`, is still caught. This proves the fix narrows scope to exclude the template's fixtures specifically, not audits in general.

- [ ] **Step 5: Commit**

```bash
git add experiments/v4/src/crawl.ts
git commit -m "experiment(v4): exclude docs/templates/ from audit input

Every pnpm crawl run reported the same two audit failures --
knowledge.template.html's own live-demo sample instances, deliberately
wired to violate orphans-except-goal/dangling-outcome so the audit
logic can be shown catching something real. But audits received
every document under docs/, including those fixtures, mixed in with
the real graph -- so a documentation fixture and an actual graph
problem looked identical in the output. Audits now exclude anything
under docs/templates/; per-instance validation is unaffected."
```

---

### Task 2: Quiet, unified, colorized output

**Files:**
- Modify: `experiments/v4/src/crawl.ts` (imports + the whole `main()` function + one new helper)

**Interfaces:**
- Consumes: `auditDocuments` from Task 1 (unchanged by this task).
- Produces: nothing consumed by other tasks — this is a presentation-layer rewrite.

- [ ] **Step 1: Add the `styleText` import**

In `experiments/v4/src/crawl.ts`, find:

```ts
import { readFileSync } from "node:fs"
```

Replace with:

```ts
import { readFileSync } from "node:fs"
import { styleText } from "node:util"
```

- [ ] **Step 2: Add a helper to format a check result's error/violation list**

Immediately after the `relative()` function (currently the last function before `main()` — check its actual position; if `main()` is defined before `relative()` in the file, add this new function directly above `main()` instead, the ordering doesn't matter to Node, only to a human reader):

```ts
function formatItems(result: CheckResult): string {
  const items = (result.errors ?? result.violations) as string[] | undefined
  if (!items || items.length === 0) return `      ${JSON.stringify(result)}`
  return items.map((item) => `      ${item}`).join("\n")
}
```

(Validators return `{ ok, errors }`; audits return `{ ok, violations }` — this handles either without needing to know which kind of check produced the result. The `JSON.stringify` fallback only fires if a `check()` ever returns neither shape, which shouldn't happen with any `check()` in this project today, but keeps this function total rather than throwing on an unexpected shape.)

- [ ] **Step 3: Replace `main()`**

Replace the entire `main()` function with:

```ts
async function main() {
  const dir = resolvePath(process.argv[2] ?? "./docs")
  const documents = parseAll(dir)
  const { templates, audits } = discoverTemplatesAndAudits(documents)
  const instances = discoverInstances(documents)
  // Audits answer whole-graph questions ("is every outcome linked to?"); the
  // template's own live-demo sample instances aren't real graph data, just a
  // documentation fixture, so they'd corrupt that answer if left in. Per-
  // instance validation (below) is unaffected — it validates one element in
  // isolation, so a sample instance in the mix is harmless there.
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
      const check = await loadCheck(template.validatorScript)
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

  for (const audit of audits) {
    checked++
    const label = `${audit.name}  (${relative(dir, audit.file)}${audit.touches ? `, touches: ${audit.touches}` : ""})`
    try {
      const check = await loadCheck(audit.scriptSource)
      const result = (await check(auditDocuments)) as CheckResult
      if (!result.ok) {
        fail++
        failures.push(`FAIL  ${label}\n${formatItems(result)}`)
      }
    } catch (err) {
      fail++
      failures.push(`FAIL  ${label}\n      audit threw — ${(err as Error).message}`)
    }
  }

  console.log(styleText(fail === 0 ? "green" : "red", `${checked} checked, ${fail} fail`))
  for (const f of failures) {
    console.log("")
    console.log(styleText("red", f))
  }
}
```

This drops the old per-instance PASS logging and the separate `validators: N pass, M fail` line entirely — no flag to bring them back.

- [ ] **Step 4: Verify quiet output on the real (healthy) graph**

```bash
cd experiments/v4
pnpm crawl
```

Expected: exactly one line of output (plus whatever trailing newline), of the shape `N checked, 0 fail` — no per-instance PASS lines, no audit JSON blocks, since nothing failed. Confirm the exact count of "checked" by comparing: `checked` should equal (number of `[data-conforms-to]` instances found under `docs/`) + (number of audits, currently 2) — you can sanity-check the instance count against `grep -rc 'data-conforms-to' experiments/v4/docs/**/*.html` if you want a second source, though exact matching isn't required since the file count naturally drifts as the graph grows.

- [ ] **Step 5: Verify color, by running directly in a terminal (not piped)**

```bash
pnpm crawl
```

Run this directly (not through `| tail`, `| grep`, or redirected to a file) and look at the output: the `N checked, 0 fail` line should render in green. `node:util`'s `styleText` detects non-TTY output (pipes, redirects) and skips emitting color codes in that case by design — this is correct behavior, not a bug, and means the automated checks in this plan (which pipe/grep) will never see raw ANSI codes; only a direct terminal run shows color. Note in your report that you observed green text directly, since this specific behavior can't be grep-verified.

- [ ] **Step 6: Verify restructured failure output, in an isolated scratch copy**

```bash
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cat > "$SCRATCH/docs/knowledge/bad-option-test.option.html" <<'EOF'
<!DOCTYPE html>
<html lang="en"><head><title>Option: bad</title></head><body>
<knowledge-option data-conforms-to="../templates/knowledge.template.html#knowledge-option">
<knowledge-title>bad</knowledge-title>
<knowledge-confidence>50</knowledge-confidence>
<knowledge-status>active</knowledge-status>
</knowledge-option>
</body></html>
EOF
node experiments/v4/src/crawl.ts "$SCRATCH/docs"
rm -rf "$SCRATCH"
```

Expected: the summary line reads `N checked, 1 fail` (red, if run directly in a terminal), followed by a blank line, then:

```
FAIL  knowledge/bad-option-test.option.html  (../templates/knowledge.template.html#knowledge-option)
      unexpected <knowledge-status> on knowledge-option
```

No raw `JSON.stringify` — a plain label line and one indented plain-text violation line.

- [ ] **Step 7: Commit**

```bash
git add experiments/v4/src/crawl.ts
git commit -m "experiment(v4): quiet, unified, colorized crawl output

Dropped the per-instance PASS line (50+ and growing, never once
useful for a routine check) and the separate validators: N pass, M
fail line, replacing both with one summary -- N checked, M fail --
colorized green/red via node:util's styleText. Failures print with a
label and indented plain-text detail instead of a raw
JSON.stringify(result) dump. No --verbose flag: nothing this session
has asked for the full per-instance listing back."
```

---

### Task 3: Rename `crawl`/`crawl.ts` → `validate`/`validate.ts`

**Files:**
- Rename: `experiments/v4/src/crawl.ts` → `experiments/v4/src/validate.ts`
- Modify: `experiments/v4/package.json`
- Modify: `experiments/v4/README.md`
- Modify: `experiments/v4/src/run.ts` (one comment line)
- Modify: `experiments/v4/docs/templates/knowledge.template.html` (one line, in prose, not code)
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: nothing consumed elsewhere — this is the last task.

- [ ] **Step 1: Rename the file**

```bash
git mv experiments/v4/src/crawl.ts experiments/v4/src/validate.ts
```

- [ ] **Step 2: Update `package.json`**

In `experiments/v4/package.json`, find:

```json
    "crawl": "node src/crawl.ts",
```

Replace with:

```json
    "validate": "node src/validate.ts",
```

- [ ] **Step 3: Update `README.md`**

Find the layout diagram line:

```
  crawl.ts       reads: validate + audit every document
  run.ts         writes: `run <id> <command> [args]`, template-declared authoring
  runtime.js     shared script-execution helper, loaded by crawl.ts, run.ts,
```

Replace with:

```
  validate.ts    reads: validate + audit every document
  run.ts         writes: `run <id> <command> [args]`, template-declared authoring
  runtime.js     shared script-execution helper, loaded by validate.ts, run.ts,
```

Find the heading and usage line:

```
## Running the crawler

```sh
pnpm crawl [dir]   # defaults to ./docs
```
```

Replace with:

```
## Running the validator

```sh
pnpm validate [dir]   # defaults to ./docs
```
```

(Leave every other mention of "the crawler" in this file's prose as-is — those describe what the tool conceptually does, not its artifact name, per this plan's Global Constraints.)

- [ ] **Step 4: Update `run.ts`'s header comment**

In `experiments/v4/src/run.ts`, find:

```ts
// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// crawl.ts: the engine knows <template>, data-conforms-to, and how to find
```

Replace with:

```ts
// mycelium run <id> <command> [args…]. Protocol-only, same discipline as
// validate.ts: the engine knows <template>, data-conforms-to, and how to find
```

- [ ] **Step 5: Update `knowledge.template.html`'s live-demo prose**

In `experiments/v4/docs/templates/knowledge.template.html`, find:

```
    so both this page and <code>crawl.ts</code> see the same function. Their <code>documents</code> argument
```

Replace with:

```
    so both this page and <code>validate.ts</code> see the same function. Their <code>documents</code> argument
```

- [ ] **Step 6: Update `CLAUDE.md`**

Four edits, all in the repo-root `CLAUDE.md` (not the global `~/.claude/CLAUDE.md`):

Find:

```
**Root `knowledge-goal` nodes are the ONLY valid orphans** — exactly what
`orphans-except-goal` (one of `knowledge.template.html`'s two collocated
audits) checks for, now for real: `pnpm crawl` runs it against the actual
files, not just sample markup. Still worth checking by eye before a crawl,
but it's an automated gate now, not just a judgment call.
```

Replace with:

```
**Root `knowledge-goal` nodes are the ONLY valid orphans** — exactly what
`orphans-except-goal` (one of `knowledge.template.html`'s two collocated
audits) checks for, now for real: `pnpm validate` runs it against the actual
files, not just sample markup. Still worth checking by eye before running
`pnpm validate`, but it's an automated gate now, not just a judgment call.
```

Find:

```
Same three questions deciduous asked. The first two are automated now —
`pnpm crawl` runs `dangling-outcome` and `orphans-except-goal` against the
real files:
```

Replace with:

```
Same three questions deciduous asked. The first two are automated now —
`pnpm validate` runs `dangling-outcome` and `orphans-except-goal` against the
real files:
```

Find:

```
pnpm --filter @mycelium/v4 crawl                 # every node, validated for real, both audits run
git status                                       # current state
```
```

Replace with:

```
pnpm --filter @mycelium/v4 validate              # every node, validated for real, both audits run
git status                                       # current state
```
```

Find:

```
`pnpm crawl` now answers most of what `deciduous nodes`/`deciduous edges`
did — it validates every instance against its own template and runs both
graph-wide audits against the real files, not sample fixtures. What it
```

Replace with:

```
`pnpm validate` now answers most of what `deciduous nodes`/`deciduous edges`
did — it validates every instance against its own template and runs both
graph-wide audits against the real files, not sample fixtures. What it
```

(Leave "not the same gap" / "the crawler. Don't invent workarounds..." near the end of the file as-is — those two use "crawler" as the tool's conceptual identity, not its artifact name, per this plan's Global Constraints.)

- [ ] **Step 7: Verify**

```bash
cd experiments/v4
pnpm validate
```

Expected: same `N checked, 0 fail` (green) output as Task 2's Step 4 — proves the rename didn't break anything.

```bash
pnpm crawl 2>&1
```

Expected: an error from pnpm that no `crawl` script exists (e.g. `Missing script: "crawl"`) — confirms this is a real rename, not an alias, matching the spec's explicit choice.

```bash
grep -rn "pnpm crawl\|crawl\.ts" CLAUDE.md README.md src/run.ts docs/templates/knowledge.template.html
```

(Run from `experiments/v4/` for the relative paths to resolve, or adjust accordingly.) Expected: no matches in any of these five files — every living reference was updated. (This grep will *not* — and should not — come up empty repo-wide; `docs/specs/*.html`, `docs/knowledge/*.html`, and the two prior `docs/superpowers/plans/*.md` files still legitimately mention `crawl`/`crawl.ts`, untouched, per this plan's Global Constraints.)

- [ ] **Step 8: Commit**

```bash
git add -A experiments/v4/src/validate.ts experiments/v4/src/crawl.ts experiments/v4/package.json experiments/v4/README.md experiments/v4/src/run.ts experiments/v4/docs/templates/knowledge.template.html CLAUDE.md
git commit -m "experiment(v4): rename crawl to validate

pnpm crawl was memorable for what the tool does internally (walk the
tree) but not for what running it is actually asking -- validate the
graph. Full rename, not an alias: the file, the pnpm script, and
every living reference to the old name (README.md, CLAUDE.md, and
two source comments). Every mention inside existing frozen specs,
past plans, and knowledge/*.html nodes is left as-is -- historical
record of what was literally true when written, same convention this
project already follows for every other past decision."
```

---

## Self-Review Notes

- **Spec coverage:** audit exclusion of `docs/templates/` → Task 1. Quiet/unified/colorized output, no verbose flag → Task 2. Full rename with the living-vs-historical split → Task 3. `spec-out-of-scope` items (no `data-audits-expect`, no `data-expects="FAIL"`, no `mycelium/validate` script type, no verbose flag) → none appear as tasks, correctly.
- **Placeholder scan:** no TBD/TODO; every code block is complete and copy-pasteable.
- **Type consistency:** `formatItems(result: CheckResult)` (Task 2) matches the existing `CheckResult` interface already declared earlier in the file (`{ ok: boolean; [key: string]: unknown }`) — no new type needed, `result.errors`/`result.violations` are read through the existing index signature.
- **Ordering:** Task 2's `main()` replacement already includes Task 1's `templatesDir`/`auditDocuments` logic inline (not just referencing it abstractly), since Task 2 replaces the entire function body Task 1 modified — an implementer working Task 2 right after Task 1 will see this is consistent with what's already on disk, not a conflicting rewrite.
