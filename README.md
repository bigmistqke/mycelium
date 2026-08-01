# mycelium

A knowledge graph as hypermedia: HTML documents that render in a browser and
are also the queryable source of truth, no separate database. Full argument
in [`docs/DESIGN.html`](docs/DESIGN.html).

## Layout

```
docs/            every document — templates, specs, and the real knowledge graph
  DESIGN.html
  theme.css
  templates/     knowledge.template.html, spec.template.html — the two node vocabularies,
                 plus template.template.html, the schema vocabulary they both use
  specs/         design specs, themselves conforming to spec.template.html,
                 named <date>-<topic>.spec.html
  knowledge/     the real graph: this project's own decision history,
                 named <date>-<slug>.<type>.html
src/             Node-only, reads/writes docs/, never opened as a webpage
  validate.ts    reads: validate + audit every document
  run.ts         writes: `run <id> <command> [args]`, template-declared authoring
  utils.ts       shared helpers: HTML parsing, template resolution, per-instance
                 validation, stdin reading, and the data: URL script loader — see
                 "Opening the documents directly" below
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
it finds — all against the real files, not sample fixtures. The crawler
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

`<id>` always resolves to `docs/templates/<id>.template.html`; `<command>` is a named export of that
file's one `<script type="mycelium/command">`. The engine only knows how to find and run that script —
what `add`/`link` actually do (field shape, where edges go) is declared inside
`knowledge.template.html` itself, not the engine. Each command documents its own arguments in a
`/** … */` comment right above its `export function`, which is also what `--help` prints — one source for
both. Full design:
[`docs/specs/2026-07-23-mycelium-authoring-commands.spec.html`](docs/specs/2026-07-23-mycelium-authoring-commands.spec.html).

`add` prefixes the filename it writes with today's actual date, computed the same way in both
`knowledge.template.html`'s and `spec.template.html`'s own `add` — `--file build-v4` on `knowledge add`
never writes `knowledge/build-v4.goal.html`, only `knowledge/<date>-build-v4.goal.html`. It's not a flag
and can't be overridden; the date is whatever day `add` actually ran on, so a node's filename and its
place in chronological order can never drift apart. Full design:
[`docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html`](docs/specs/2026-07-24-mycelium-spec-authoring-commands.spec.html).

## Opening the documents directly

Every file under `docs/` is meant to be opened straight in a browser, no
server required — no exceptions. A real ES module import is CORS-checked
even for local files, and `file://` has no stable origin to satisfy that
check — which is why the one thing that would otherwise need importing
across the Node/browser boundary (a five-line `data:` URL script loader)
isn't imported at all: it's written once in `src/utils.ts` for the Node
side, and duplicated directly inline in the one browser-facing live demo
that needs it, rather than shared through a file either side would have to
import.
