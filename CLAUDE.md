# Project Instructions

## Knowledge Graph Workflow

**THIS IS MANDATORY. Log decisions IN REAL-TIME, not retroactively.**

As of 2026-07-23 this project's decision graph is written as HTML nodes under
`experiments/v4/knowledge/`, conforming to the templates in
`experiments/v4/templates/knowledge.template.html`. It replaces `deciduous`
(the SQLite-backed CLI) for all new logging, project-wide, not just
v4-related work — even though v4 itself is still nominally "the experiment,"
there's nowhere better for this to live yet. `deciduous`'s existing ~400
nodes (v0 through 2026-07-23) are **frozen, not migrated**: still real
history, still queryable read-only via the `deciduous` CLI, just no longer
where new work gets logged. Full reasoning:
`experiments/v4/specs/2026-07-23-deciduous-template-series.spec.html`.

There is no CLI for this yet — `mycelium run` and the crawler are
deliberately deferred (see `experiments/v4/DESIGN.html`'s roadmap). Logging
a decision means hand-authoring an HTML file. Copying the closest existing
node under `experiments/v4/knowledge/` as a starting point is the fastest
correct way to do this.

### The Core Rule

```
BEFORE you do something -> Write a knowledge-goal or knowledge-action node
AFTER it succeeds/fails  -> Write a knowledge-outcome node
CONNECT immediately      -> <a data-rel="..."> from the new node to its parent
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

Six types, in one file: `experiments/v4/templates/knowledge.template.html`
is the source of truth for exact required/optional fields per type — don't
duplicate that table here, read it. In short: every type has `title` and
`confidence`; `status` (`pending`/`active`/`completed`/`rejected`) is on
`goal`/`decision`/`action` only; `commit`/`files`/`branch` are optional on
`action`/`outcome` only; `prompt` is optional, `goal` only.

```html
experiments/v4/knowledge/<slug>.<type>.html   (type = goal|decision|option|action|outcome|observation)

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
audits) checks for. It isn't wired to run against real files yet (that's
crawler work), so this is still a human judgment call for now, not an
automated gate.

The six `data-rel` edge labels, unchanged from deciduous:
`depends_on`, `blocks`, `supports`, `contradicts`, `alternative_to`,
`leads_to`. Mint new ones when a project genuinely needs them (see
`DESIGN.html`'s "open-vocabulary links"), the same way `specifies` and
`elaborates` got minted for the spec-doc work.

### CRITICAL: Link Commits to Actions/Outcomes

**After every git commit, add the hash to the relevant node!**

```bash
git commit -m "feat: add auth"
```
Then edit the `knowledge-action` or `knowledge-outcome` node this commit
belongs to (or write a new one) and set:
```html
<knowledge-commit>HEAD's short hash</knowledge-commit>
<knowledge-branch>main</knowledge-branch>
```
If a single commit doesn't map cleanly to one node — spans several nodes'
worth of work, or one node spans several commits — omit `knowledge-commit`
rather than pointing it at just one arbitrarily. `write-template-series.action.html`
does this on purpose.

### Audit Checklist (Before Every Commit)

Same three questions deciduous asked, still manual until the crawler exists:

1. Does every **knowledge-outcome** link back to what caused it?
2. Does every **knowledge-action** link to why you did it?
3. Any dangling nodes, besides root goals?

### Session Start Checklist

```bash
ls experiments/v4/knowledge/                     # what nodes exist?
grep -l 'data-rel' experiments/v4/knowledge/*.html   # rough connectivity
git status                                       # current state
```
Coarser than `deciduous nodes`/`deciduous edges` were — there's no crawler
yet to answer "which outcome has no incoming edge" as a single command.
That's exactly what `mycelium run` + the crawler will give back, deferred
on purpose (`DESIGN.html`'s roadmap, step 3).

### What deciduous still has, that this doesn't (yet)

No equivalent exists yet for: `deciduous sync`/`docs/graph-data.json`/GitHub
Pages publishing, `.deciduous/config.toml` branch grouping, or
`deciduous diff export/apply` multi-user sync. These aren't silently
dropped — they're real capability gaps versus the old system, waiting on
the crawler. Don't invent workarounds for them; note the gap and move on.
