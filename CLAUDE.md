# Project Instructions

## Knowledge Graph Workflow

**THIS IS MANDATORY. Log decisions IN REAL-TIME, not retroactively.**

As of 2026-07-23 this project's decision graph is written as HTML nodes under
`experiments/v4/docs/knowledge/`, conforming to the templates in
`experiments/v4/docs/templates/knowledge.template.html`. It replaces `deciduous`
(the SQLite-backed CLI) for all new logging, project-wide, not just
v4-related work — even though v4 itself is still nominally "the experiment,"
there's nowhere better for this to live yet. `deciduous`'s existing ~400
nodes (v0 through 2026-07-23) are **frozen**: still real history, still
queryable read-only via the `deciduous` CLI, just no longer where new work
gets logged. Full reasoning:
`experiments/v4/docs/specs/2026-07-23-deciduous-template-series.spec.html`.

**60 of those 400 were imported on 2026-07-30**, by one rule: a node comes in
only if it can be linked to material already here. See
`experiments/v4/docs/knowledge/2026-07-30-link-do-not-tag.decision.html`.
Imported nodes keep their original date in the filename — that prefix is what
records which exploration a node belongs to, which is why `add` grew a
`--date` flag and why you should leave it alone when authoring.

### CRITICAL: how to cite a deciduous node

Two forms, and the difference is load-bearing:

| Form | Means |
|---|---|
| `<a href="./2026-07-13-status-derived-not-declared.observation.html">#311</a>` | **imported** — the node is in the graph, the link resolves, you can click it |
| a bare `#311` with no link | **not imported** — a reference into the frozen SQLite log, only resolvable via the `deciduous` CLI |

Never write a bare `#N` for a node that *is* in the graph. `#N` is a foreign
key into a dead database; once a node is imported it has a real address, and a
link is checkable where a number is not. Writing the href also forces you to
open the target, which is the step that catches a wrong reference — two of
twenty citations pointed at the wrong node before anyone checked
(`2026-07-30-two-of-twenty-citations-were-hollow.observation.html`).

**Use the CLI to log, don't hand-author.** As of this same day, all three of
`mycelium run`'s knowledge commands exist and are tested working:

```bash
pnpm --filter @mycelium/v4 mycelium knowledge add <type> --title "…" --confidence NN [--status S] [--prompt "…"] [--detail "…" | --detail -] [--commit HASH] [--date YYYY-MM-DD] --file <slug>
pnpm --filter @mycelium/v4 mycelium knowledge link <from-file> <to-file> --rel <rel> --label "…"
pnpm --filter @mycelium/v4 mycelium knowledge update <file> [--title "…"] [--confidence NN] [--status S] [--prompt "…"] [--detail "…" | --detail - | --detail ""] [--commit HASH] [--files "…"] [--branch NAME]
```
(`--filter @mycelium/v4` works from anywhere in the repo; drop it and just run
`pnpm mycelium ...` if already inside `experiments/v4/`.)

**`--detail` is where the finding goes.** The title is a title — a line you
can scan in a list. Everything else (the evidence, the numbers, the reasoning,
the caveats) belongs in `--detail`, which takes real HTML with no tag
restriction. For anything longer than a line, pass `--detail -` and pipe the
content in on stdin via a heredoc, which avoids fighting shell quoting. On
`update`, `--detail ""` clears the field.

This flag existed for days before it was written down here, and the cost was
measurable: eight nodes written on 2026-07-27 average 415 characters of title
against 117 for the rest of the graph, and use `detail` zero times. An agent
copies the signature, not the prose — so if a field is missing from the line
above, it does not get used.

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
`action`/`outcome` only; `prompt` is optional, `goal` only; `detail` is
optional on every type (free-form content, including `<script>`, no tag
restriction — see
`experiments/v4/docs/specs/2026-07-24-mycelium-knowledge-detail-field.spec.html`).

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
audits) checks for, now for real: `pnpm validate` runs it against the actual
files, not just sample markup. Still worth checking by eye before running
`pnpm validate`, but it's an automated gate now, not just a judgment call.

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

Then update the `knowledge-action` node this commit belongs to — via the CLI, not a hand edit:

```bash
pnpm --filter @mycelium/v4 mycelium knowledge update <action-file> --commit <HEAD's short hash> --branch main
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
`pnpm validate` runs `dangling-outcome` and `orphans-except-goal` against the
real files:

1. Does every **knowledge-outcome** link back to what caused it? (`dangling-outcome`)
2. Any dangling nodes, besides root goals? (`orphans-except-goal`)
3. Does every **knowledge-action** link to why you did it? Still a judgment
   call — no audit checks "why," only "is it connected at all."

### Session Start Checklist

```bash
pnpm --filter @mycelium/v4 mycelium knowledge recover   # the graph's live threads
pnpm --filter @mycelium/v4 validate                     # every node validated, all four audits run
git status                                              # current state
```
`knowledge recover` replaces the old `/recover` slash command, which drove
the frozen CLI. It prints three things, each a property of the graph rather
than of any node: **active goals**, **decisions with no outcome** (an outcome
reachable through outgoing edges, or one pointing back), and **contested
claims** (either end of a `contradicts` edge). It is read-only and a
SessionStart hook runs it automatically, so this is here as documentation
rather than something to remember.

`pnpm validate` validates every instance against its own template and runs
the four graph-wide audits. It **exits non-zero on failure** — true only
since 2026-07-30; before that it printed failures and exited 0, so no audit
had ever actually gated anything.

For a plain enumeration rather than a verdict, `mycelium knowledge list
nodes` and `list edges` are what `deciduous nodes`/`deciduous edges` used to
give you.

### What deciduous still has, that this doesn't (yet)

No equivalent exists yet for: `deciduous sync`/`docs/graph-data.json`/GitHub
Pages publishing, `.deciduous/config.toml` branch grouping, or
`deciduous diff export/apply` multi-user sync. These aren't silently
dropped — they're real capability gaps versus the old system, waiting on
the crawler. Don't invent workarounds for them; note the gap and move on.
