# mycelium

You write this:

```html
<!-- docs/templates/spec.template.html -->
<template id="spec-doc">
  <spec-title required></spec-title>
  <spec-status required enum="draft approved implemented"></spec-status>
</template>

<script type="mycelium/command">
  import type { CommandContext } from "../../src/api.ts"

  /**
   * Create a new spec-doc file.
   *
   *   mycelium spec add --title "…" --file <undated-topic>
   *     [--status draft|approved|implemented]
   *
   * --status defaults to "draft" if omitted.
   * …
   */
  export async function add({ fs, args, cli }: CommandContext) { … }
</script>
```

You get a command, documented by the comment above it:

```sh
$ pnpm mycelium spec --help
commands for "spec" (templates/spec.template.html):

  add
    Create a new spec-doc file.

      mycelium spec add --title "…" --file <undated-topic>
        [--status draft|approved|implemented]

    --status defaults to "draft" if omitted.
```

And every document claiming that type gets held to the shape:

```sh
$ pnpm mycelium validate
803 checked, 0 fail
```

The CLI is empty by itself. Every command it has arrives the way that one did, from a document carrying the implementation and the documentation together. Even validation is a document: `docs/commands/validate.command.html` declares the command you just ran, and the engine has no notion of a spec, a plan, or a decision.

A command reads those fields as structured data, so it can query them, sort them, and check them. A person reads the document they sit in. The scripts beside them run on either side: one block renders a live demo in a browser, another runs under Node with the whole dependency tree in reach. A block both sides need exports from `<script type="module" id="…">`, which either one imports as `#…`.

Content, documentation, and the code acting on both sit in one file, with no second copy to fall behind.

Nothing here is packaged for another codebase yet. The project runs all of this on its own development, which is what the rest of this page describes.

## Core

Everything in this section comes from the engine. It is the whole of what mycelium knows, and it never grows when a project adds a family.

### The protocol

Everything the engine understands, in one table. A document is otherwise ordinary HTML.

| marker                                | what the engine does with it                                     |
| ------------------------------------- | ---------------------------------------------------------------- |
| `data-conforms-to="<file>#<type>"`    | checks that element against that type                            |
| `<template id="<type>">`              | reads the shape: `required`, `pattern`, `enum`                   |
| `<script type="mycelium/command">`    | its exports become subcommands, its doc comments become `--help` |
| `data-audits="<name>"`                | runs that check across every document at once                    |
| `data-validates="#<type>"`            | runs that check on one instance                                  |
| `data-touches` / `data-expects`       | which types an audit concerns, which violations it declares      |
| `#<id>` or `<file>#<id>` in an import | resolves to that script, in this document or another             |

That list is the whole vocabulary. Everything else is a convention some template invented, and core stays out of it. The language family runs its writing rules that way: each rule is a document stating the rule in prose and carrying the code that enforces it, loaded by that family's own audit. Its checks reach document prose, the markdown at the repository root, and the comments and JSDoc in every source file.

### The template file

One file declares a family: the types, the shape each one takes, the commands that author them, and the checks they answer to. A document claims one of those types by linking to it, addressed by path and fragment:

```html
<spec-doc data-conforms-to="../templates/spec.template.html#spec-doc">
  <spec-title>Authoring commands</spec-title>
  <spec-status>implemented</spec-status>
</spec-doc>
```

### The `<template>` element is the schema

A `<template>` is inert: a browser parses it and renders nothing, which makes it somewhere to keep a type's skeleton where no reader mistakes it for content. Each child is a field, and three attributes constrain one:

| attribute      | meaning                                              |
| -------------- | ---------------------------------------------------- |
| `required`     | the field must appear, carrying non-empty text       |
| `pattern="…"`  | its text must match this regular expression          |
| `enum="a b c"` | its text must be one of these space-separated values |

```html
<template id="knowledge-observation">
  <knowledge-title required></knowledge-title>
  <knowledge-confidence
    required
    pattern="^(0|[1-9][0-9]?|100)$"
  ></knowledge-confidence>
  <knowledge-detail></knowledge-detail>
</template>
```

A field carrying none of the three stays optional and free-form. A field the template never declares is an error, so a mistyped tag name fails instead of sitting there unread. An empty element is also an error, required or not, because a field present but blank claims something the document never says.

### A check the schema cannot state

Presence, pattern and enumeration cover most of it. A constraint reaching past those goes in a script beside the template:

```html
<script data-validates="#knowledge-observation">
  export function check(root) { … }
</script>
```

The attribute names the type this checks, and `check` receives the conforming element. The schema pass runs first and this one runs after, so such a function only adds constraints and never replaces what the template already states.

No type in this repository needs one today. Every hand-written check moved into the schema once the attributes could say it, and a constraint the schema still cannot express usually spans documents, which makes it an audit instead.

### What the scripts may use

A `<script type="mycelium/…">` is TypeScript. Node strips the annotations at run time, so nothing stands between the file and running it, and the loader keys on the `mycelium/` prefix rather than a list of names.

Four kinds of import resolve from inside one:

```html
<script type="mycelium/command">
  import retextPassive from "retext-passive"              // a package
  import type { CommandContext } from "../../src/api.ts"  // a file
  import { render } from "#preview"                       // a script in this document
  import { validateFromTemplate }                         // a script in another
    from "./template.template.html#validate-from-template"
</script>

<script type="module" id="preview">
  export function render(root) { … }
</script>
```

A bare specifier falls through to Node's own resolver, so a script reaches `node_modules` and the `node:` builtins. The passive-voice rule imports `retext` and `retext-passive` to do its work.

The last two forms are what let one block serve both sides. `#preview` above runs in a browser when someone opens the page, and the command imports that same source rather than a copy of it. This is not hypothetical plumbing: `src/utils.ts` reaches into `template.template.html#validate-from-template` exactly this way, which is how the generic schema validator gets loaded.

### What a command may do

Nothing constrains it. A command is ordinary code holding the file tree, so it can author a document, run a shell command, call a model, or render the whole corpus as a page. Mycelium's part is finding it and running it.

### Commands without a type

Some commands belong to no family. A `.command.html` file declares those: it carries the same `<script type="mycelium/command">` and no `<template>`, because nothing conforms to it and there is no shape to state.

```
docs/commands/explore.command.html    mycelium explore list
docs/commands/validate.command.html   mycelium validate
```

Both work on the whole tree, which is what puts them here. `explore list` reports every conforming element under `docs/`. No family template could own that, since each one knows only its own types. `validate` checks the corpus against whatever each document declares.

An `<id>` resolves to `<id>.template.html` first and `<id>.command.html` second, so both kinds answer the same invocation. A host may also export a default, which runs when no subcommand follows it. That is why `mycelium validate` needs no second word.

## Templates

Nothing above mentions a spec or a decision, because the engine has never heard of either. The five below are what this project wrote for itself while building it, and they are the actual experiment.

- [knowledge](https://bigmistqke.github.io/mycelium/templates/knowledge.template.html): the decision graph behind this project, spanning goal, decision, option, action, outcome, and observation (inspired by [deciduous](https://crates.io/crates/deciduous), the CLI this project kept its graph in before)
- [spec](https://bigmistqke.github.io/mycelium/templates/spec.template.html): a design spec that precedes or accompanies the work (inspired by the [superpowers](https://github.com/obra/superpowers) skill of the same name)
- [plan](https://bigmistqke.github.io/mycelium/templates/plan.template.html): a plan whose steps carry a shell command that proves they're done (inspired by the [superpowers](https://github.com/obra/superpowers) skill of the same name)
- [language](https://bigmistqke.github.io/mycelium/templates/language.template.html): the writing rules and terms of art this project holds itself to (inspired by [ASD-STE100](https://www.asd-ste100.org/), the controlled English of aerospace maintenance manuals)
- [template](https://bigmistqke.github.io/mycelium/templates/template.template.html): the schema vocabulary the other four build on

Each one is itself a document. Open it directly and it renders in a browser. It is the source of truth, not documentation about one. They also point at each other the way web pages always have: a hyperlink in the prose for a reader, or a `data-rel` edge for a command to follow.

### One document, several types

A document may hold more than one conforming element. A plan file is one: a `plan-doc` holding tasks, each task holding steps, and each step holding its checks. That comes to dozens of elements in a single file, and all four types belong to the plan family.

The engine never asks them to come from one family. An element of any other type could sit among them, so a decision could live in the same file as the plan step that carries it out. The audit keeping content inside its declared type steps over any sibling declaring its own, which is what makes that legal. No document does this today.

## Getting started

```sh
pnpm mycelium --help         # every host and every command, read off the documents declaring them
pnpm mycelium <id> --help    # one host's own flags and caveats
```

`<id>` is any file under `docs/` named `<id>.template.html` or `<id>.command.html`. Start from the roster rather than from this page: the engine carries no commands of its own, so `mycelium validate` reaches it the same way `mycelium spec add` does, and a family written tomorrow appears there without anyone editing a list.

Node ≥24. Type annotations in `.ts` files are stripped natively at run time; no build step, no `tsx`/`ts-node`.

## See also

- [DESIGN](https://bigmistqke.github.io/mycelium/DESIGN.html): the original argument for building this way, written before any of it existed
- [editor/README.md](editor/README.md): every `<script>` block under `docs/` gets its own virtual file and the right language
