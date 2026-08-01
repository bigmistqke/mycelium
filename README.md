# mycelium

A generic protocol engine: a template is an HTML document that declares a
vocabulary — field shapes, cross-document validators, CLI commands — and any
other document opts into that vocabulary by linking to the one template it
conforms to. The engine itself has no built-in notion of "goal," "decision,"
or any other type; it only knows how to read a `<template>` element, a
`data-conforms-to` link, and a `<script type="mycelium/command">`. Full
argument in [`docs/DESIGN.html`](docs/DESIGN.html).

This project's own decision history is the proof of the idea, not a special
case living alongside it: the knowledge graph below is one template family
among several — specs, runnable plans, and writing rules are built the exact
same way, with no engine code that knows any of them by name.

## Layout

```
docs/            every document — templates and every real instance of them
  DESIGN.html    the argument for building this way at all
  theme.css
  templates/     one file per family, each pairing a <template> shape with the
                 script(s) that validate and author it
    template.template.html   the schema vocabulary the other four build on
    knowledge.template.html  knowledge-goal/decision/option/action/outcome/observation —
                             this project's own decision graph
    spec.template.html       spec-doc — a design spec, written before or alongside the work
    plan.template.html       plan-doc/task/step/check — a plan whose steps can carry a
                             shell command that proves they're done
    language.template.html   language-term/rule — this project's writing rules and terms
                             of art, some of which carry an automated check
  commands/      one-off utility commands with no document type of their own
  knowledge/     the real graph, named <date>-<slug>.<type>.html
  specs/         real specs, named <date>-<topic>.spec.html
  plans/         real plans, named <date>-<topic>.plan.html
  language/      real terms and rules
src/             Node-only, reads/writes docs/, never opened as a webpage
  run.ts         writes: `run <id> <command> [args]`, template-declared authoring
  validate.ts    reads: validate + audit every document
  utils.ts       shared helpers: HTML parsing, template resolution, per-instance
                 validation, stdin reading, and the data: URL script loader — see
                 "Opening the documents directly" below
  api.ts         the type contract every command script is written against
editor/          a language server that gives each <script> block under docs/
                 its own virtual file and the right language, instead of
                 merging a document into one file or ignoring the block
                 outright — see editor/README.md
```

## Requirements

Node ≥24. Type annotations in `.ts` files are stripped natively at run time —
no build step, no `tsx`/`ts-node`.

## Running the validator

```sh
pnpm validate [dir]   # defaults to ./docs
```

Walks every `.html` file under `dir`, validates each instance against its
own parsed subtree — a generic, attribute-driven check read off the
type's `<template>` (see `templates/template.template.html`), falling
back to a type's own `data-validates` script as additional validation
when one still exists — and runs every collocated cross-document audit
it finds — all against the real files, not sample fixtures. The engine
has no built-in notion of what a "goal" or an "edge" is; it only knows
the templating protocol (`<template>`, `data-conforms-to`,
`data-validates`, `data-audits`). Full design:
[`docs/specs/2026-07-23-mycelium-crawler.spec.html`](docs/specs/2026-07-23-mycelium-crawler.spec.html).

## Writing a new node or edge

```sh
pnpm mycelium <id> --help                 # list that template's commands, from their own doc comments
pnpm mycelium knowledge add goal --title "…" --confidence 85 --file build-v4
  # writes docs/knowledge/<today's-date>-build-v4.goal.html
pnpm mycelium knowledge link 2026-07-23-build-v4.goal.html 2026-07-23-html-as-store.decision.html --rel leads_to --label "…"
```

`<id>` resolves to whichever file under `docs/` is named `<id>.template.html` or `<id>.command.html` —
the latter for a one-off command with no document type of its own, like `docs/commands/explore.command.html`.
`<command>` is a named export of that file's one `<script type="mycelium/command">`. The engine only
knows how to find and run that script —
what `add`/`link` actually do (field shape, where edges go) is declared inside the template document
itself, not the engine. Each command documents its own arguments in a
`/** … */` comment right above its `export function`, which is also what `--help` prints — one source
for both, the same way for every family. `mycelium run --help` prints the full roster of every family
and every command it exports, read off those same comments, rather than a hand-maintained list. Full
design: [`docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`](docs/specs/2026-07-23-mycelium-authoring-commands.spec.html).

`add` prefixes the filename it writes with today's actual date, computed the same way in every
family's own `add` — `--file build-v4` on `knowledge add`
never writes `knowledge/build-v4.goal.html`, only `knowledge/<date>-build-v4.goal.html`. It's not a flag
and can't be overridden; the date is whatever day `add` actually ran on, so a node's filename and its
place in chronological order can never drift apart. Full design:
[`docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html`](docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html).

## Editor support

Every `<script>` block under `docs/` gets its own virtual file and the right
language — TypeScript or JavaScript, decided by the block's own `type`
attribute — instead of being merged into one file per document or ignored
outright because an editor doesn't recognize the `type`. See
[`editor/README.md`](editor/README.md) for how it works and how to install it.

## Opening the documents directly

Every file under `docs/` is meant to be opened straight in a browser, no
server required — no exceptions. A real ES module import is CORS-checked
even for local files, and `file://` has no stable origin to satisfy that
check — which is why the one thing that would otherwise need importing
across the Node/browser boundary (a five-line `data:` URL script loader)
isn't imported at all: it's written once in `src/utils.ts` for the Node
side, and duplicated directly inline in each browser-facing live demo that
needs it, rather than shared through a file either side would have to
import.
