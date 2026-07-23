# Project Instructions

## Knowledge Graph Workflow

**THIS IS MANDATORY. Log decisions IN REAL-TIME, not retroactively.**

As of 2026-07-23 this project's decision graph is written as HTML nodes under
`experiments/v4/docs/knowledge/`, conforming to the templates in
`experiments/v4/docs/templates/knowledge.template.html`. It replaces `deciduous`
(the SQLite-backed CLI) for all new logging, project-wide, not just
v4-related work — even though v4 itself is still nominally "the experiment,"
there's nowhere better for this to live yet. `deciduous`'s existing ~400
nodes (v0 through 2026-07-23) are **frozen, not migrated**: still real
history, still queryable read-only via the `deciduous` CLI, just no longer
where new work gets logged. Full reasoning:
`experiments/v4/docs/specs/2026-07-23-deciduous-template-series.spec.html`.

**Use the CLI to log, don't hand-author.** As of this same day, both halves of
`mycelium run` exist and are tested working:

```bash
pnpm --filter @mycelium/v4 mycelium knowledge add <type> --title "…" --confidence NN [--status S] [--prompt "…"] [--commit HASH] --file <slug>
pnpm --filter @mycelium/v4 mycelium knowledge link <from-file> <to-file> --rel <rel> --label "…"
```
(`--filter @mycelium/v4` works from anywhere in the repo; drop it and just run
`pnpm mycelium ...` if already inside `experiments/v4/`.)

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

### The Core Rule

```
BEFORE you do something -> `pnpm mycelium knowledge add goal|action ...`
AFTER it succeeds/fails  -> `pnpm mycelium knowledge add outcome ...`
CONNECT immediately      -> `pnpm mycelium knowledge link <from> <to> --rel ...`
AUDIT regularly          -> Check for missing connections (see below)
```

### Behavioral Triggers - MUST LOG WHEN:

| Trigger | Node type | Example |
|---------|-----------|---------|
| User asks for a new feature | `knowledge-goal` **with `<knowledge-prompt>`** | "Add dark mode" |
| Choosing between approaches | `knowledge-decision` | "Choose state management" |
| About to write/edit code | `knowledge-action` | "Implementing Redux store" |
| Something worked or failed | `knowledge-outcome` | "Redux integration successful" |
| Notice something interesting | `knowledge-observation` | "Existing code uses hooks" |

### CRITICAL: Capture VERBATIM User Prompts

**`<knowledge-prompt>` must be the EXACT user message, not a summary.** When
a user request triggers new work, capture their full message word-for-word
inside the field — same rule deciduous had for `-p`/`--prompt-stdin`, just a
tag instead of a flag.

**When to capture prompts:**
- Root `knowledge-goal` nodes: YES — the FULL original request
- Major direction changes: YES — when user redirects the work
- Routine downstream nodes: NO — they inherit context via `data-rel` edges

### Node shape

Six types, in one file: `experiments/v4/docs/templates/knowledge.template.html`
is the source of truth for exact required/optional fields per type — don't
duplicate that table here, read it. In short: every type has `title` and
`confidence`; `status` (`pending`/`active`/`completed`/`rejected`) is on
`goal`/`decision`/`action` only; `commit`/`files`/`branch` are optional on
`action`/`outcome` only; `prompt` is optional, `goal` only.

```html
experiments/v4/docs/knowledge/<slug>.<type>.html   (type = goal|decision|option|action|outcome|observation)

<knowledge-TYPE data-conforms-to="../templates/knowledge.template.html#knowledge-TYPE">
  <knowledge-title>…</knowledge-title>
  <knowledge-confidence>NN</knowledge-confidence>
  <knowledge-status>pending</knowledge-status>
  <a data-rel="leads_to" href="./other-node.type.html">…</a>
</knowledge-TYPE>
```

### CRITICAL: Maintain Connections

**The graph's value is in its CONNECTIONS, not just nodes.**

| When you create... | IMMEDIATELY link to... |
|-------------------|------------------------|
| `knowledge-outcome` | The action/goal it resolves |
| `knowledge-action` | The goal/decision that spawned it |
| `knowledge-option` | Its parent decision (`depends_on`) |
| `knowledge-observation` | Related goal/action |

**Root `knowledge-goal` nodes are the ONLY valid orphans** — exactly what
`orphans-except-goal` (one of `knowledge.template.html`'s two collocated
audits) checks for, now for real: `pnpm crawl` runs it against the actual
files, not just sample markup. Still worth checking by eye before a crawl,
but it's an automated gate now, not just a judgment call.

The six `data-rel` edge labels, unchanged from deciduous:
`depends_on`, `blocks`, `supports`, `contradicts`, `alternative_to`,
`leads_to`. Mint new ones when a project genuinely needs them (see
`DESIGN.html`'s "open-vocabulary links"), the same way `specifies` and
`elaborates` got minted for the spec-doc work.

### CRITICAL: Link Commits to Actions/Outcomes

**After every git commit, add the hash to the relevant node — but that
usually means editing the node you already wrote, not writing a new one.**

```bash
git commit -m "feat: add auth"
```
Edit the `knowledge-action` node this commit belongs to and set:
```html
<knowledge-commit>HEAD's short hash</knowledge-commit>
<knowledge-branch>main</knowledge-branch>
```
A **new** `knowledge-outcome` node is for reporting something not already
evident from the action: a result that differs from what was planned, a
verification that actually ran, a failure, a surprise. "The thing the
action said would happen, happened, here's the hash" is not new
information — it belongs in the action node's own `knowledge-commit`
field, not a second file whose only content is confirming the first one.
Writing one anyway for every single commit is exactly the over-fragmentation
["field vs link"](experiments/v4/docs/specs/2026-07-23-deciduous-template-series.spec.html#field-vs-link)
already warns against, just at the level of nodes instead of fields.

If a single commit doesn't map cleanly to one node — spans several nodes'
worth of work, or one node spans several commits — omit `knowledge-commit`
rather than pointing it at just one arbitrarily. `write-template-series.action.html`
does this on purpose.

### Audit Checklist (Before Every Commit)

Same three questions deciduous asked. The first two are automated now —
`pnpm crawl` runs `dangling-outcome` and `orphans-except-goal` against the
real files:

1. Does every **knowledge-outcome** link back to what caused it? (`dangling-outcome`)
2. Any dangling nodes, besides root goals? (`orphans-except-goal`)
3. Does every **knowledge-action** link to why you did it? Still a judgment
   call — no audit checks "why," only "is it connected at all."

### Session Start Checklist

```bash
pnpm --filter @mycelium/v4 crawl                 # every node, validated for real, both audits run
git status                                       # current state
```
`pnpm crawl` now answers most of what `deciduous nodes`/`deciduous edges`
did — it validates every instance against its own template and runs both
graph-wide audits against the real files, not sample fixtures. What it
still doesn't do: print a clean list of nodes/edges the way `deciduous
nodes`/`deciduous edges` did (it reports pass/fail, not an enumeration) —
a real, narrower gap than "no crawler," not the same gap.

### What deciduous still has, that this doesn't (yet)

No equivalent exists yet for: `deciduous sync`/`docs/graph-data.json`/GitHub
Pages publishing, `.deciduous/config.toml` branch grouping, or
`deciduous diff export/apply` multi-user sync. These aren't silently
dropped — they're real capability gaps versus the old system, waiting on
the crawler. Don't invent workarounds for them; note the gap and move on.
