# Editor support for this project's HTML documents

Most of this project's code lives inside `<script>` blocks in `.mycelium/`, and an
editor does two unhelpful things with them. It builds one virtual JavaScript
document per HTML file and concatenates every script into it, merging scopes
that are separate when they run. And it ignores a script whose `type` it does
not recognize, which is every script this project cares about.

Both follow from treating the file as the unit. This treats a block as the unit.

## What is here

| | |
|---|---|
| `language-plugin.ts` | The whole of what is project-specific. One virtual file per script block, and the block's `type` decides its language. |
| `server.ts` | Standard Volar wiring. Speaks LSP over stdio. |
| `check.ts` | Runs the plugin over real files and prints what it finds, with no editor involved. |
| `vscode/` | The VS Code extension that starts the server. |

The rule the plugin applies is the one
`.mycelium/specs/2026-08-01-script-type-decides-the-language.spec.html` states, and
it is the same rule `src/script-hooks.ts` applies when it decides a module's
format. If one changes, the other is wrong:

| Script type | Runtime | Language |
|---|---|---|
| `mycelium/*` | Node only | TypeScript |
| `module`, classic | a browser | JavaScript |

## Running it without an editor

```
pnpm check-scripts                      # every document
node editor/check.ts .mycelium/templates/knowledge.template.html
```

Diagnostics come back at positions in the HTML file, not in the virtual files.
A wrong mapping shows up as a line number that does not match the source, so
this is worth reading rather than just counting.

## Installing the extension

There is no build step. The server is TypeScript run directly, because Node
strips types itself.

```
ln -s "$PWD/editor/vscode" ~/.vscode/extensions/mycelium-language-support
```

Then reload VS Code and open any document under `.mycelium/`. Output appears under
the "Mycelium" output channel. `mycelium.server.path` overrides which
`server.ts` is launched, for working on the server itself.

## Known limits

`getExtraServiceScripts`, which is what gives each block its own file, is
available to a language server and not to a TypeScript plugin. So this is a
server and cannot be repackaged as a `typescript.tsdk` plugin without losing
the one property it exists for.

Diagnostics run under the project's own `tsconfig.json`, which is `strict`.
Applied to code that has never been type-checked, that currently reports around
180 findings, most of them implicit `any` on inner callbacks. They are real, but
they are a backlog rather than a breakage, and `pnpm mycelium validate` does not gate on
them.
