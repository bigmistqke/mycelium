# @mycelium/v4

A knowledge graph as hypermedia: HTML documents that render in a browser and
are also the queryable source of truth, no separate database. Full argument
in [`docs/DESIGN.html`](docs/DESIGN.html).

## Layout

```
docs/            every document — templates, specs, and the real knowledge graph
  DESIGN.html
  theme.css
  templates/     knowledge.template.html, spec.template.html — the two node vocabularies
  specs/         design specs, themselves conforming to spec.template.html
  knowledge/     the real graph: this project's own decision history
src/             the crawler — Node-only, reads docs/, never opened as a webpage
  crawl.ts
  runtime.js     shared script-execution helper (loadCheck), imported by both
                 crawl.ts and one browser-facing live demo
```

## Requirements

Node ≥24. Type annotations in `.ts` files are stripped natively at run time —
no build step, no `tsx`/`ts-node`.

## Running the crawler

```sh
pnpm crawl [dir]   # defaults to ./docs
```

Walks every `.html` file under `dir`, runs each instance's per-type
validator against its own parsed subtree, and runs every collocated
cross-document audit it finds — all against the real files, not sample
fixtures. The crawler has no built-in notion of what a "goal" or an "edge"
is; it only knows the templating protocol (`<template>`,
`data-conforms-to`, `data-validates`, `data-audits`). Full design:
[`docs/specs/2026-07-23-mycelium-crawler.spec.html`](docs/specs/2026-07-23-mycelium-crawler.spec.html).

## Opening the documents directly

Every file under `docs/` is meant to be opened straight in a browser, no
server required — that's the whole point. One exception: the live demo in
`knowledge.template.html`'s "Graph-wide audits" section imports
`src/runtime.js` as a real ES module to avoid duplicating code with the
crawler, and browsers CORS-check module imports even for local files. That
one demo needs a static server:

```sh
pnpm serve
```

Everything else — every other live demo, every node, every spec — still
works with a plain double-click.
