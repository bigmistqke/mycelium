# Knowledge CLI `update` Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `mycelium knowledge update <file>` command that upserts/clears fields on an existing `knowledge/*.html` node, and make each node type's validator reject fields outside its own shape, so `pnpm crawl` catches a misplaced field regardless of what wrote it.

**Architecture:** Both pieces live entirely inside `experiments/v4/docs/templates/knowledge.template.html` — no engine changes. (1) Each of the six `data-validates` scripts gains one more check: any `knowledge-*` child of the root not in that type's allowed-field list is an error. (2) The existing `type="mycelium/command"` script gains a third export, `update`, sibling to `add`/`link`, using the same `fs.get`/DOM-mutation pattern `link` already uses.

**Tech Stack:** Node ≥24 native TS stripping, happy-dom (DOM parsing), acorn (already added for `--help` extraction, untouched by this work). No test framework exists in this project — verification is `pnpm crawl` (the crawler's own validators/audits) plus direct CLI invocation with inspected output, matching how every prior piece of this project has been verified.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-23-mycelium-update-command.spec.html` — read it before starting; every task below implements one part of it.
- No new dependencies. No changes to `src/run.ts` or `src/crawl.ts` (both stay protocol-only per `experiments/v4/docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`).
- `update` does **not** replicate `add`'s per-type field gating (`REQUIRES_STATUS`, prompt-only-on-goal). It writes whatever field is asked for; the closed-schema check added in Task 1 is what catches a mismatch, on the next `pnpm crawl`, not immediately in the CLI. Do not add client-side type gating to `update` — that would contradict the spec's explicit design choice.
- Run all `pnpm` commands from `experiments/v4/` (or prefix with `pnpm --filter @mycelium/v4` from the repo root).
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link` (and, after Task 2, `update`) to log actions/outcomes as you go, the same way prior work in this repo did.

---

### Task 1: Closed-schema check on all six `knowledge-*` validators

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html:81-100` (`knowledge-goal` validator)
- Modify: `experiments/v4/docs/templates/knowledge.template.html:119-136` (`knowledge-decision` validator)
- Modify: `experiments/v4/docs/templates/knowledge.template.html:156-169` (`knowledge-option` validator)
- Modify: `experiments/v4/docs/templates/knowledge.template.html:193-214` (`knowledge-action` validator)
- Modify: `experiments/v4/docs/templates/knowledge.template.html:236-253` (`knowledge-outcome` validator)
- Modify: `experiments/v4/docs/templates/knowledge.template.html:270-283` (`knowledge-observation` validator)

**Interfaces:**
- Consumes: nothing from other tasks — this task is self-contained.
- Produces: nothing later tasks call directly. Later tasks (2, 3) rely on `pnpm crawl` reporting `unexpected <tag> on knowledge-<type>` for any field outside a type's shape — that exact error message format is what Task 2's verification step greps for.

Each of the six validators currently ends with a required-field loop, an optional confidence-range check, and (for `action`/`outcome`) an optional-field loop, then `return { ok: errors.length === 0, errors }`. Add one more check to each, right before that `return`, that walks every direct child of the root element and flags any `knowledge-*` tag not on that type's allowed list.

- [ ] **Step 1: Edit the `knowledge-goal` validator**

In `experiments/v4/docs/templates/knowledge.template.html`, find (around line 97-99):

```js
    const prompt = el.querySelector('knowledge-prompt')
    if (prompt && !prompt.textContent.trim()) errors.push('<knowledge-prompt> present but empty — omit it instead')
    return { ok: errors.length === 0, errors }
```

Replace with:

```js
    const prompt = el.querySelector('knowledge-prompt')
    if (prompt && !prompt.textContent.trim()) errors.push('<knowledge-prompt> present but empty — omit it instead')
    const allowed = ['knowledge-title', 'knowledge-confidence', 'knowledge-status', 'knowledge-prompt']
    for (const child of el.children) {
      const tag = child.tagName.toLowerCase()
      if (tag.startsWith('knowledge-') && !allowed.includes(tag)) errors.push(`unexpected <${tag}> on knowledge-goal`)
    }
    return { ok: errors.length === 0, errors }
```

- [ ] **Step 2: Edit the `knowledge-decision` validator**

Find (around line 131-135):

```js
    const status = el.querySelector('knowledge-status')?.textContent.trim()
    if (status && !['pending', 'active', 'completed', 'rejected'].includes(status)) {
      errors.push(`<knowledge-status> must be pending|active|completed|rejected, got "${status}"`)
    }
    return { ok: errors.length === 0, errors }
```

This exact five-line shape appears in `knowledge-goal`, `knowledge-decision`, and `knowledge-action`'s validators — use surrounding context (the preceding `<knowledge-prompt>` check for goal, the following optional-field loop for action) to target the right one. For `knowledge-decision` specifically, replace its copy with:

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
```

- [ ] **Step 3: Edit the `knowledge-option` validator**

Find (around line 164-168):

```js
    const confidence = el.querySelector('knowledge-confidence')?.textContent.trim()
    if (confidence && (!/^\d+$/.test(confidence) || +confidence < 0 || +confidence > 100)) {
      errors.push(`<knowledge-confidence> must be an integer 0-100, got "${confidence}"`)
    }
    return { ok: errors.length === 0, errors }
```

This shape (confidence check immediately followed by `return`) also appears in `knowledge-observation`'s validator — use the preceding `if (!el) return...` and the `knowledge-option` element check above it to confirm you're in the right block. For `knowledge-option`, replace with:

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
```

- [ ] **Step 4: Edit the `knowledge-action` validator**

Find (around line 209-213):

```js
    for (const tag of ['knowledge-commit', 'knowledge-files', 'knowledge-branch']) {
      const node = el.querySelector(tag)
      if (node && !node.textContent.trim()) errors.push(`<${tag}> present but empty — omit it instead`)
    }
    return { ok: errors.length === 0, errors }
```

This shape (the commit/files/branch empty-check loop followed by `return`) also appears in `knowledge-outcome`'s validator — use the preceding status-enum check (present for `action`, absent for `outcome`) to confirm you're editing `knowledge-action`. Replace with:

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
    return { ok: errors.length === 0, errors }
```

- [ ] **Step 5: Edit the `knowledge-outcome` validator**

Same commit/files/branch loop as Step 4, but in the `knowledge-outcome` validator (no preceding status-enum check — `knowledge-outcome` has no `knowledge-status` field at all). Replace with:

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
    return { ok: errors.length === 0, errors }
```

- [ ] **Step 6: Edit the `knowledge-observation` validator**

Same confidence-check-then-return shape as Step 3, but in the `knowledge-observation` validator (last of the six `<script data-validates>` blocks in the file). Replace with:

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
    return { ok: errors.length === 0, errors }
```

- [ ] **Step 7: Verify no regression against the real graph**

Run from `experiments/v4/`:

```bash
pnpm crawl
```

Expected: the same baseline as before this change — `validators: 37 pass, 0 fail`, and the same two pre-existing audit failures (`orphans-except-goal` on `sample-observation`, `dangling-outcome` on `sample-outcome` — these are sample-fixture violations the template's own live demo deliberately wires in, unrelated to this change). If any real node now fails, a real node has a field outside its type's shape — inspect and fix that node before continuing; do not weaken the check to make it pass.

- [ ] **Step 8: Verify the new check actually triggers, in an isolated scratch copy**

```bash
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cat > "$SCRATCH/docs/knowledge/bad.option.html" <<'EOF'
<!DOCTYPE html>
<html lang="en"><head><title>Option: bad</title></head><body>
<knowledge-option data-conforms-to="../templates/knowledge.template.html#knowledge-option">
<knowledge-title>bad</knowledge-title>
<knowledge-confidence>50</knowledge-confidence>
<knowledge-status>active</knowledge-status>
</knowledge-option>
</body></html>
EOF
node experiments/v4/src/crawl.ts "$SCRATCH/docs" 2>&1 | grep "bad.option"
```

Expected output includes a FAIL line for `knowledge/bad.option.html` whose JSON body contains `"unexpected <knowledge-status> on knowledge-option"`. Then clean up:

```bash
rm -rf "$SCRATCH"
```

- [ ] **Step 9: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): reject fields outside a knowledge-* type's own shape

Each type's validator only checked that required fields were present,
never that a node carried nothing beyond its own type's fields — a
stray <knowledge-status> on a knowledge-option would have passed
pnpm crawl silently, from a hand-edit or any future command alike.
Union each type's required+optional tag lists into an allowed set and
flag anything outside it."
```

---

### Task 2: `update` command

**Files:**
- Modify: `experiments/v4/docs/templates/knowledge.template.html:596-616` (the `type="mycelium/command"` script — add a third export after `link`)

**Interfaces:**
- Consumes: `fs.get(path)` (returns a mutable `Document`, already used by `link` at line 608) and the `parseArgs`/dispatch machinery in `src/run.ts` — neither changes in this task.
- Produces: the CLI surface `mycelium knowledge update <file> [--title …] [--confidence …] [--status …] [--prompt …] [--commit …] [--files …] [--branch …]`, discoverable via `mycelium knowledge --help` (automatic, via the existing JSDoc-extraction mechanism — no extra wiring needed).

- [ ] **Step 1: Add the `update` export**

In `experiments/v4/docs/templates/knowledge.template.html`, immediately after the closing `}` of `export function link(fs, args) { … }` (currently the last line before `</script>`, around line 615), insert:

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

- [ ] **Step 2: Verify `--help` picks it up automatically**

```bash
cd experiments/v4 && pnpm mycelium knowledge --help
```

Expected: output now lists three commands — `add`, `link`, `update` — with `update`'s doc comment printed verbatim (this is the JSDoc-extraction mechanism from the acorn work earlier this session; no changes needed to `src/run.ts` for this to work).

- [ ] **Step 3: Verify upsert, overwrite, and clear semantics in an isolated scratch copy**

```bash
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cd "$SCRATCH"
node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge add action --title "scratch test" --confidence 60 --file scratch-update-test

node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge update scratch-update-test.action.html --status completed --commit abc1234
grep -A1 'knowledge-status' docs/knowledge/scratch-update-test.action.html
grep -A1 'knowledge-commit' docs/knowledge/scratch-update-test.action.html

node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge update scratch-update-test.action.html --commit def5678
grep 'knowledge-commit' docs/knowledge/scratch-update-test.action.html

node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge update scratch-update-test.action.html --commit ""
grep -c 'knowledge-commit' docs/knowledge/scratch-update-test.action.html

cd /Users/bigmistqke/Documents/GitHub/mycelium
rm -rf "$SCRATCH"
```

Expected: after the first `update`, the file contains `<knowledge-status>completed</knowledge-status>` and `<knowledge-commit>abc1234</knowledge-commit>` (appended — the seed file from `add` has neither). After the second `update`, `knowledge-commit` shows `def5678` (overwritten, not duplicated — grepping for the tag returns exactly one match). After the third `update`, the `grep -c` count is `0` (the field was removed entirely, not left empty).

- [ ] **Step 4: Verify the Task 1 closed-schema check catches a wrong-type update, in an isolated scratch copy**

```bash
SCRATCH=$(mktemp -d)
cp -r experiments/v4/docs "$SCRATCH/docs"
cd "$SCRATCH"
node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge add option --title "scratch option" --confidence 50 --file scratch-option-test

node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/run.ts \
  knowledge update scratch-option-test.option.html --status active

node /Users/bigmistqke/Documents/GitHub/mycelium/experiments/v4/src/crawl.ts docs 2>&1 | grep "scratch-option-test"
cd /Users/bigmistqke/Documents/GitHub/mycelium
rm -rf "$SCRATCH"
```

Expected: `update` succeeds unconditionally (writes the `<knowledge-status>` — no client-side gating, per the spec's design), but the `crawl` line for `knowledge/scratch-option-test.option.html` reports FAIL with `"unexpected <knowledge-status> on knowledge-option"` — confirming the two tasks compose the way the spec describes: `update` stays simple, the validator is the safety net.

- [ ] **Step 5: Dogfood it for real**

Run `pnpm crawl` from `experiments/v4/` and confirm the same clean baseline as Task 1 Step 7. Then commit this task's own code change (Step 6 below) and use the new command on the action node CLAUDE.md's own logging workflow expects you to have created for this task — set its `--status completed --commit <the short hash from the commit you just made> --branch main` — instead of hand-editing it. This is the real-world case the spec was written to fix; use it once here as the first real usage.

- [ ] **Step 6: Commit**

```bash
git add experiments/v4/docs/templates/knowledge.template.html
git commit -m "experiment(v4): add mycelium knowledge update, close the field-update gap

add only ever set fields at creation time; filling in a status or
commit hash on an existing node — which happens after nearly every
piece of real work — still meant a hand Read+Edit. update reads the
file's own root tag for its type (no <type> arg to re-type), upserts
whatever field is given, and removes a field on an explicit empty
value. It doesn't replicate add's per-type field gating — the
closed-schema check from the previous commit is what catches a
mismatch, on the next pnpm crawl."
```

(Then use `pnpm mycelium knowledge update` — not a hand-edit — to set this action node's own `--status`/`--commit`/`--branch`, per Step 5.)

---

### Task 3: Update CLAUDE.md to reflect the closed gap

**Files:**
- Modify: `CLAUDE.md` (repo root, project instructions) — do not touch the global user `~/.claude/CLAUDE.md`.

**Interfaces:**
- Consumes: nothing code-level — this task only edits documentation prose to match Tasks 1-2's shipped behavior.
- Produces: nothing consumed by other tasks. This is the last task.

`CLAUDE.md` currently documents the `add`/`link`-only gap this plan closes, and separately instructs hand-editing a node's `<knowledge-commit>` after every commit. Both need to change now that `update` exists.

- [ ] **Step 1: Add `update` to the CLI usage block**

Find, near the top of `CLAUDE.md`, under "**Use the CLI to log, don't hand-author.**":

```
pnpm --filter @mycelium/v4 mycelium knowledge add <type> --title "…" --confidence NN [--status S] [--prompt "…"] [--commit HASH] --file <slug>
pnpm --filter @mycelium/v4 mycelium knowledge link <from-file> <to-file> --rel <rel> --label "…"
```

Replace with:

```
pnpm --filter @mycelium/v4 mycelium knowledge add <type> --title "…" --confidence NN [--status S] [--prompt "…"] [--commit HASH] --file <slug>
pnpm --filter @mycelium/v4 mycelium knowledge link <from-file> <to-file> --rel <rel> --label "…"
pnpm --filter @mycelium/v4 mycelium knowledge update <file> [--title "…"] [--confidence NN] [--status S] [--prompt "…"] [--commit HASH] [--files "…"] [--branch NAME]
```

- [ ] **Step 2: Narrow the "two real gaps" paragraph to one**

Find the paragraph beginning "This replaces the Write/Read+Edit dance for every node/edge `knowledge-*` covers":

```
This replaces the Write/Read+Edit dance for every node/edge `knowledge-*`
covers — no file content passes through the model doing the logging, same
as `deciduous add`/`deciduous link` never did. Two real gaps, not silently
papered over: it only covers the `knowledge-*` family (`spec.template.html`
has no `type="mycelium/command"` script yet, spec docs still need hand-authoring),
and `add` only sets fields at creation time — updating a field on an
already-existing node (e.g. adding `<knowledge-commit>` to an action node
written before its commit existed) still means a direct edit. Fall back to
hand-authoring only for those two cases; copying the closest existing node
under `experiments/v4/docs/knowledge/` as a starting point is still the
fastest correct way to do that. Full design:
`experiments/v4/docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`.
```

Replace with:

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

- [ ] **Step 3: Replace the hand-edit instruction under "Link Commits to Actions/Outcomes"**

Find the section (exact heading and surrounding prose):

```
### CRITICAL: Link Commits to Actions/Outcomes

**After every git commit, add the hash to the relevant node — but that
usually means editing the node you already wrote, not writing a new one.**

git commit -m "feat: add auth"

Edit the `knowledge-action` node this commit belongs to and set:
<knowledge-commit>HEAD's short hash</knowledge-commit>
<knowledge-branch>main</knowledge-branch>
```

Reproduce the heading and bold intro line exactly as they are; only the `git commit`/edit instructions change. Replace them with:

```
git commit -m "feat: add auth"
```

Then update the `knowledge-action` node this commit belongs to — via the CLI, not a hand edit:

```
pnpm --filter @mycelium/v4 mycelium knowledge update <action-file> --commit <HEAD's short hash> --branch main
```

- [ ] **Step 4: Verify the edits**

```bash
grep -n "mycelium knowledge update" CLAUDE.md
grep -n "Two real gaps" CLAUDE.md
```

Expected: the first grep shows the three lines added in Steps 1 and 3; the second grep returns nothing (that phrase no longer exists, replaced in Step 2).

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: point CLAUDE.md at mycelium knowledge update, close the gap it named

CLAUDE.md documented two real gaps in the authoring CLI; one of them
(add only sets fields at creation time) is now closed by the update
command built in this branch. Update the CLI usage block, narrow the
gaps paragraph to the one that remains (spec-doc authoring commands),
and point the commit-linking instruction at the CLI instead of a
hand-edit."
```

---

## Self-Review Notes

- **Spec coverage:** Closed-schema check (spec-design §1) → Task 1. `update` command shape, upsert/overwrite/clear semantics, no client-side type gating (spec-design §2) → Task 2. "Where this lives" (no engine changes) → honored throughout; no `src/run.ts`/`src/crawl.ts` edits in any task. `spec-out-of-scope` items (no edge removal, no immediate CLI-side validation, no spec-doc commands, no interactive prompts/auto-slugging) → none of them appear as tasks, correctly.
- **Placeholder scan:** no TBD/TODO; every code block is complete, copy-pasteable.
- **Type consistency:** `field(tag, text)` in Task 2 matches the `field(tag, text)` helper already established in `add` (same name, same two-arg shape, same `doc`/`root` closure pattern) — intentional, for a reader comparing the two commands side by side.
