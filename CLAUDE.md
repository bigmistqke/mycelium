# Project Instructions

## The notebook

Log in real time, not retroactively.

This project keeps the thinking that underpins its code as HTML entries under
`docs/notebook/`, conforming to `docs/templates/notebook.template.html`. The
canon is where thinking crystallises, and the notebook is where it stays fluid:
prior art somebody read, a rule noticed before a check could hold it, a
direction the work bends toward, a remark about how the work itself goes.

Neither the code nor git carries that. A task leaves artefacts everywhere, so
writing one down a second time protects nothing, while the reasoning underneath
leaves nothing at all.

An intention — something to come back to — is not this. That belongs in the
followup family below, which drains where the notebook accumulates. Design:
`docs/specs/2026-08-09-notebook-replaces-the-knowledge-graph.spec.html`.

### Three types, by where the knowledge came from

| Type | Comes from | Holds |
|------|------------|-------|
| `notebook-observation` | thinking | something you noticed, at any altitude |
| `notebook-research` | someone else | prior art, external work, things read |
| `notebook-experiment` | running something | a question, a script, and its reading |

Provenance is the axis because it does not move. What an entry is *about*
drifts as the project's vocabulary shifts, and that drift is what left one
earlier type doing five jobs across 231 nodes. An entry never changes type: a
thought that arrived one way did not arrive the other.

### The commands

```bash
pnpm mycelium notebook add <type> --title "…" [--tag NAME]… [--prompt "…" | --prompt -] [--detail "…" | --detail -] [--question "…"] [--file <slug>]
pnpm mycelium notebook update <file> [--title "…"] [--tag NAME]… [--prompt "…"] [--detail "…" | --detail - | --detail ""] [--question "…"] [--reading "…"]
pnpm mycelium notebook link <from-file> <to-file> --rel <rel> --label "…"
pnpm mycelium notebook unlink <from-file> <to-file> --rel <rel>
pnpm mycelium notebook del <file>
pnpm mycelium notebook list [entries|edges]
pnpm mycelium notebook tags
pnpm mycelium notebook run <file> [--record]
pnpm mycelium notebook generate graph [--out <path>] [--base [<href>]]
```
(Run from the repository root — pnpm resolves `mycelium` from the root
`package.json` regardless of which subdirectory the shell is in.)

This block is a convenience, not the roster. `mycelium --help` prints every
family and every command it exports, read off the command scripts themselves,
and `mycelium <family> --help` prints one family's full flags straight from
each command's own doc comment. Prefer both over what this file says: a person
maintains this by hand, and it has been wrong before. If you find a command in
`--help` that is missing here, add it.

Use the CLI, never a hand edit. No file content passes through the model doing
the logging, which is the point.

### What an entry carries, and what it does not

`--file` takes a bare slug with **no date on it**, and nothing prepends one. An
entry accretes, so a date on it would be a second copy of what git already
answers, and the first thing to go stale. A slug carrying a date is refused
outright with an error naming the slug to pass instead.

Confidence and status both left. 570 earlier nodes carried a confidence, 60% of
them sat on three values, and nothing ever read the field. Status belonged to
the goals that left, and nothing fluid is pending.

`--detail` is where the finding goes. The title is a title — a line you can
scan in a list — and everything else belongs in `--detail`, which takes real
HTML with no tag restriction. For anything longer than a line pass `--detail -`
and pipe it in on a heredoc; on `update`, `--detail ""` clears it.

That flag went undocumented for days and the cost was measurable: eight nodes
from one afternoon average 415 characters of title against 117 for the rest,
and use `detail` zero times. An agent copies the signature, not the prose.

`--tag` repeats and takes a plain name. A tag matching an entry of the same
name reads as a link to it, and one matching nothing stays a word until
somebody writes that page. `notebook tags` prints the vocabulary with counts,
which is how a near-duplicate shows up as drift and a typo shows up alone.

### An experiment carries its instrument

`notebook run <file>` runs an experiment's `mycelium/experiment` script and
prints what it returns. `--record` writes that into `notebook-reading`, so the
next run has something to disagree with — and the disagreement is the finding.
A red check means the code broke; a changed reading means the corpus moved.

Nothing here runs during `validate`. A probe that fails a build is a check with
worse manners, and a probe is allowed to be inconclusive.

Write the document before you know the answer, because running the script is
how the answer arrives. Every capture failure this project has recorded has the
same shape: logging after the work competes with the work and loses. Here
nothing remains to do afterward.

### Edges

Eight `data-rel` labels: `depends_on`, `blocks`, `supports`, `contradicts`,
`alternative_to`, `leads_to`, `specifies`, `elaborates`. The schema holds that
list as a pattern on the `<a>` each type declares, so `validate` rejects a
ninth rather than accepting it.

`link <from-file> <to-file>` always writes the edge inside `<from-file>`, so
argument order decides direction, and "link X to Y" in prose does not say which
is which. `link` upserts on (rel, href), so it can correct a label but never a
direction or a wrong `--rel`. Those leave a second, wrong edge beside the right
one, and `unlink` then `link` is the two-command repair. Do not delete and
rebuild an entry.

`del` removes an entry **and** every edge pointing at it, printing each one it
drops, because an incoming edge is something upstream resting on what you just
took away.

No audit requires an entry to carry an edge. A wiki has stubs, and 49 entries
came out of the 2026-08-10 prune with none.

### CRITICAL: what a reader can open

Two stores have been deleted, and the same rule covers both.

An earlier SQLite log froze on 2026-07-23 and went on 2026-07-30. Its node
numbers (`#349`) meant something only inside it, and nothing here may refer to
them. 60 of its ~400 nodes came in as imports first, by one rule: a node comes
in only if it links to material already here.

Then on 2026-08-10 the graph itself lost 203 of 579 entries — build records
that git already held, task goals, bug notes, and stale measurements. What
survived is what nothing else holds.

So: **an entry may only refer to what a reader can open.** Not a number in a
deleted database, and not something recoverable only from git history — git is
not a place a reader can follow a link to. When nothing holds the target, describe it
rather than cite it: "an option about which language to implement in". The
description is what a reader needed anyway.

An external source is fine, and wanted, so long as the link is live. Entries on
IBIS, on truth-maintenance systems and on the capture cost that killed earlier
rationale systems all link straight out to the work they name.

Writing the href forces you to open the target, which is the step that catches
a wrong reference — two of twenty citations pointed at the wrong node before
anyone checked.

### CRITICAL: the spec comes before the implementation

Once a design settles, write its spec doc before you touch a source file.
Not after, and not alongside.

The reason is dogfooding, and it is the whole point rather than a nicety.
This project builds authoring tooling for specs and for notebook entries, so
the only way that tooling gets exercised on real input is by using it on
this project's own work. Skip to the implementation and the commands only
ever run on toy input, which is how `--detail` went undocumented for days
while eight nodes stuffed their findings into the title instead.

Expect the first draft to fail `prose-follows-the-language`. No paragraph
opens with a bolded headline, four sentences per paragraph is the ceiling,
and passive voice is out. Budget a rewrite pass rather than treating the
failure as a surprise.

Spec docs get the same treatment now too, via `spec.template.html`'s own
`add`/`update`. There is no `link`, since a spec's cross-references live
inside its own rich-field markup, not as separate edges, and no `list`
yet — deferred, not forgotten:

```bash
pnpm mycelium spec add --title "…" --file <undated-topic> [--status draft|approved|implemented] --body "…"
pnpm mycelium spec update <file> [--title "…"] [--status S] [--body "…"]
```
`spec add`'s `--file` is undated the same way `notebook add`'s is, and refuses a
dated slug for the same reason. One difference: a spec does carry a date, always
today's, filling both the filename and the `<spec-date>` field from one value so
the two can never drift apart.

No hand-authoring gap remains for either family. Full design:
`docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`
(commands),
`docs/specs/2026-07-23-mycelium-update-command.spec.html`
(`update`, and the closed-schema validator check that backs it), and
`docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html`
(spec's own `add`/`update`, its single `--body` flag covering multiple
rich fields at once, and the date-prefixed-filename convention both
families now share).

### Follow-ups: the store that drains

When you notice something mid-work that belongs later, it goes here and not
in the notebook. Eleven entries read as deferrals before this
family existed, seven of them naming no condition at all, and two have been
dead since January without anything saying so.

```bash
pnpm mycelium followup add --title "…" --at <repo-relative-path> [--label "…"] [--when "…"] [--file <slug>]
pnpm mycelium followup list
pnpm mycelium followup done <file>
```

`--at` is required and it is the whole design. It takes a path from the
repository root — a document, a template or a source file, optionally with a
`#fragment` — and the command works out the relative href itself. The item then
sits in front of whoever next opens that file, so nobody reads a list to find
it, and `every-link-resolves` fails the build when the target goes away. A
stale item cannot sit there quietly.

An item carries **no date and no status**. It exists in order to stop existing,
so `done` deletes the file rather than marking it, and git holds what the
project decided not to do. Do not add priority, size or assignment: `plan`'s
twelve documents hold 286 statuses that all say `completed`, which is what a
maintained progress field becomes.

Design: `docs/specs/2026-08-09-followup-family.spec.html`.

### Tests

`test.template.html` holds a family whose instances are tests. A test
document lives in `docs/tests/<slug>.test.html` and carries no date.

```bash
pnpm mycelium canon test [<file>] [--show] [--timeout MS] [--port N]
pnpm mycelium canon list
```

The script type on a case decides which runner opens it. Nothing else
declares the split, because `mycelium/*` already means "loads only under
Node" for every script in the project:

- `<script type="mycelium/test">` — a **node case**. TypeScript, exports one
  default function taking `{ assert, sandbox }`. `sandbox` is a throwaway
  documents tree with
  the real templates linked in; `sandbox.mycelium(...argv)` runs the real
  command line against it and `read`/`exists`/`write` reach the files. One
  fresh sandbox per case.
- `<script type="text/mycelium-test">` — a **browser case**. Plain
  JavaScript, an async function body, given `fixture`, `settle` and
  `assert`. It must NOT use the `mycelium/` prefix: that would make the
  editor and `script-hooks.ts` treat browser code as TypeScript, and a type
  annotation would then fail only at run time in the page.

Throwing fails a case, either way. A document may not mix the two kinds —
an audit checks this.

Node documents run first and alone, so a run with no browser cases never
starts Chrome. Browser documents open in headless Chrome over W3C
WebDriver; a chromedriver matching the installed Chrome downloads on first
use into `node_modules/.cache/`, and CI uses the one the runner already
has. `--show` runs a visible browser. Every failing browser case leaves a
screenshot of its fixture beside the document.

Only a browser document is its own report. Open it and watch each
`<test-status>` go from PENDING to SUCCESS or FAILURE. A node document has
no rendering, so its verdicts go to the command's output.

There is **no `add`**. A test's substance is a fixture and a script, and
neither fits on a flag, so writing one means writing the markup — the state
`figure` is also in. This is the one family where hand-authoring is correct.

PENDING is the only verdict a file may hold, and the schema enforces it. A
result belongs to a run, so nothing commits one. Do not "helpfully" write
SUCCESS into a document.

`validate` cannot test the figure engine, and no audit ever will: it parses
with happy-dom, which computes no layout, so every rect is zero. See
`docs/notebook/happy-dom-computes-no-layout.observation.html`.

### The canon family: what the project holds true, and what it promises

A canon document is one subsystem: `docs/canon/<subsystem>.canon.html`, holding
that subsystem's own axioms and the specification its behaviours belong to. An
axiom carries no confidence and no date, because it states what holds now. How
it came to hold, and how sure anybody was, belongs to a notebook entry — dated,
carrying the prompt behind it, and never rewritten afterwards.
`root.canon.html` holds the axioms that govern everything, and a subsystem axiom
narrows one of those.

An axiom also carries a required `--detail`, holding the reasoning under the
principle. A title states the rule in one line, and one line has no room for
what the rule rules out or what it cost to learn. The field was optional until
2026-08-09 and the first eleven axioms used it zero times, which is what a
field nobody has to fill gets you. Full design:
`docs/specs/2026-08-06-canon-template-html.spec.html` and
`docs/specs/2026-08-08-behaviour-cites-its-axiom.spec.html`.

```bash
pnpm mycelium canon add axiom --canon <name> --id <slug> --title "…" --detail "…" | --detail -
pnpm mycelium canon add specification --canon <name> --id <slug> --title "…"
pnpm mycelium canon add behaviour --canon <name> --id <slug> --title "…"
pnpm mycelium canon update <canon>#<id> [--title "…"] [--id <slug>] [--detail "…"]
pnpm mycelium canon link <canon>#<id> <target> --rel <rel> --label "…"
pnpm mycelium canon unlink <canon>#<id> <target> --rel <rel>
pnpm mycelium canon reference <canon>#<id> <entry> --label "…"
pnpm mycelium canon unreference <canon>#<id> <entry>
pnpm mycelium canon move <canon>#<id> <to-canon>
```

Nothing here carries a date, and there is no `--date` flag. These describe what
holds now: an axiom that stops being true gets revised or retired, and a
specification that no longer matches the system is a bug in one of the two.

The citation sits on the claim and never on the container. A behaviour names
the axiom it refines and an axiom names the general one it narrows, both with
`depends_on`. A specification carries only `specifies`, pointing at the code it
answers for. A subsystem is a grouping of files, so nothing can contradict one
and nothing can derive one from a principle either — only a claim does that.

Where an axiom belongs follows from who cites it. One cited from more than one
subsystem goes in root; one cited only by its own subsystem lives with it. Use
`move` when that changes: a claim whose home is wrong is a different problem
from a claim that is wrong, so `move` carries every citation with it. `update
--id` does the opposite on purpose, failing every citation, because there the
claim itself changed.

A test cites the behaviour it checks with an ordinary edge on its own
`test-case`, placed directly after `test-status` where the schema ranks it:

```html
<a data-rel="depends_on" href="../canon/validate.canon.html#exits-non-zero-on-failure">the behaviour this checks</a>
```

A case carries an `id`, so both ends of a citation have an address and
`every-link-resolves` checks it like any other link. A citation gets judged on
where it lands, never on what carries it, so one resolving to an axiom rather
than a behaviour is a finding: the test knows something no specification states.

Three audits check the chain, and `pnpm mycelium validate` runs them with
everything else. `grounded` checks two things and both are per-claim: a
behaviour naming no axiom is freelancing, and an axiom no behaviour reaches is
dead, since nothing beneath it can push back. `exhaustive`: every behaviour has
a case citing it. `cited`: every case cites a behaviour. Nothing is exempt on
either side of that last joint, so adding a test case means adding the behaviour
it answers to.

Two honest limits, neither closed by any check. Rewording a behaviour in place
keeps every citation resolving, so nothing tells the citing cases they now check
something the document no longer claims. And a broad axiom nobody has read down
into a subsystem reaches nothing there, which no check separates from an axiom
that genuinely does not apply.

### The core rule

```
NOTICE something        -> pnpm mycelium notebook add observation|research ...
MEASURE something       -> pnpm mycelium notebook add experiment ...   (then run --record)
CONNECT it              -> pnpm mycelium notebook link <from> <to> --rel ...
SOMETHING FOR LATER     -> pnpm mycelium followup add --at <path> ...
```

Nothing logs that work happened. Git holds commits, the checks hold whether the
code works, and a second copy of either drifts from the first. 170 of the 203
entries dropped on 2026-08-10 recorded doing, and a commit hook manufactured
most of them.

### Log when

| Trigger | Type | Example |
|---------|------|---------|
| You notice something worth keeping | `notebook-observation` | "A gate known to fail teaches people to ignore it" |
| You read something outside this project | `notebook-research` | "Unison identifies code by the hash of its AST" |
| You measure the corpus or probe behaviour | `notebook-experiment` | "How many entries state a rule?" |
| You settle on a rule the canon should hold | an axiom, which cites the entry it came from | |
| You notice something for later | a followup, with `--at` | |

A number you wrote down goes stale the moment you write it. If a finding is a
count, make it an experiment so it can recompute — that is the whole reason the
type exists.

### CRITICAL: capture verbatim prompts

`--prompt` must be the exact message, not a summary. It repeats, and it sits on
any entry rather than on one type, since an entry gathers prompts over months.

Capture one when a request opens a line of thinking, and when somebody redirects
the work. Routine entries inherit context through their edges and need none.

A prompt is a record of what somebody typed, so nothing edits one to satisfy a
style rule — `language-prose.ts` exempts the field for exactly that reason.

### Entry shape

`docs/templates/notebook.template.html` is the source of truth for required and
optional fields per type; read it rather than trusting a copy here.

```html
docs/notebook/<slug>.<type>.html   (type = observation | research | experiment)

<notebook-observation data-conforms-to="../templates/notebook.template.html#notebook-observation">
  <notebook-title>…</notebook-title>
  <notebook-tag>…</notebook-tag>
  <notebook-prompt>… somebody's exact words …</notebook-prompt>
  <notebook-detail>… any markup …</notebook-detail>
  <a data-rel="supports" href="./other-entry.observation.html">…</a>
</notebook-observation>
```

### Grounding an axiom

An axiom names what it came from, with `canon reference`, which writes an
ordinary anchor inside a `canon-references` child. Nothing marks an entry as
promoted and nothing tracks a queue: promotion would need state to keep in sync,
and one link already carries the fact.

Containment does the work. No ninth relation joins the vocabulary, the axiom's
own `depends_on` pattern stays untouched, and `grounded` reads direct children
only, so a reference cannot make a claim look load-bearing.

`--label` is required, and it says what the claim took from that entry rather
than restating either end. A reader can open the href for what the entry says;
what they cannot reconstruct is which part of it hardened into the rule.

Most axioms carry no reference, and that is a reading rather than a gate: much
of the canon came top-down from the implementation, so demanding grounding now
would manufacture entries to satisfy the check. For the current count, run
`notebook run how-many-axioms-name-where-they-came-from.experiment.html` — a
number written here instead would be the same stale copy that had this section
claiming a field nothing had built.

### Before every commit

`pnpm mycelium validate` validates every instance against its own template and
runs every corpus-wide audit. It **exits non-zero on failure**. `mycelium
--help` lists the audits, so read that rather than a count here.

Three audits that policed the old types went with them: `orphans-except-goal`,
`dangling-outcome` and `hollow-action` all lost their subject on 2026-08-10.

The order a template lists its placeholders in binds, so a field written before
one the template ranks earlier fails validation. You should never hit this,
since every authoring command places a field where its template puts it. If you
hand-edit a document and get it wrong, `pnpm mycelium validate autofix` sorts
every instance's fields back into declared order.

### Session start

```bash
pnpm mycelium followup list   # what is outstanding, and where it applies
pnpm mycelium validate        # every document validated, every audit run
git status                    # current state
```

A SessionStart hook runs the first already, so this is documentation rather
than something to remember. `recover` went with the goals and decisions it
reported on.

### Capability gaps

Three things the earlier system did that this one does not: publishing the
graph as a browsable site, grouping nodes by git branch, and exchanging
patches between people working in parallel. These aren't silently dropped —
they're real gaps, waiting on the crawler. Don't invent workarounds; note the
gap and move on.
