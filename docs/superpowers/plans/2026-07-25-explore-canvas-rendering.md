# Explore Canvas Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `serve` command to `docs/commands/explore.command.html` that starts a local HTTP server and renders the v4 `docs/` tree as a canvas of real document panels connected by visible lines — a sidebar to browse the whole tree, panels loaded via `fetch` into shadow roots, link clicks that open connected panels instead of navigating, drag-to-reposition with live connector recomputation, a backlinks count/toggle per panel, and canvas layout persisted in the URL.

**Architecture:** One new exported command, `serve`, in the existing `<script type="mycelium/command">` block of `docs/commands/explore.command.html`, sibling to the already-shipped `list`. It starts a plain `node:http` server rooted at `docs/`: any request path maps to a file under `docs/` and is served as static content, except `GET /`, which serves a generated shell page built by a new `renderExplorePage(treeJson, edgesJson)` template-string function (same shape as `knowledge.template.html`'s `renderGraphPage`). The tree (for the sidebar) and the edge list (for backlinks) are both computed once at server startup via `fs.list(".")` — the same `Filesystem` method `list` already uses — and inlined into the shell page as JSON, the same inlining pattern `generate graph` already uses for its own payload. Everything client-side is plain JS with no framework and no build step, consistent with every other generated page in this project.

**Tech Stack:** Node ≥24 (`node:http`, `node:fs`, `node:path`), happy-dom (already a dependency, used indirectly via `fs.list`), no new dependencies. No test framework — verification is starting the server and checking behavior directly in a browser, plus `pnpm validate` staying clean, the same way `explore list` was verified.

## Global Constraints

- Full design: `experiments/v4/docs/specs/2026-07-25-explore-canvas-rendering.spec.html` — read it before starting.
- No new dependencies. No framework, no bundler, no build step — everything lives inside the one `<script type="mycelium/command">` block and the client-side `<script>` it generates as a string.
- Run all `pnpm`/`node` commands from `experiments/v4/`.
- One deliberate refinement on top of the spec, stated here so it isn't silent: the spec says the sidebar tree is "computed server-side on each request to `/`." This plan computes the tree (and the edge list backlinks need) **once, at server startup**, cached in memory for the server's lifetime, not re-walked on every page load. Every other generated artifact in this project (`generate graph`, this tool's own `list`) is a snapshot of the tree at the moment it runs, not a live view — `serve` follows the same convention. Restart the server to pick up doc changes, same as re-running `generate graph` to pick up new nodes.
- Connector endpoints are computed purely from the two panels' own `getBoundingClientRect()` (nearest-edge-to-nearest-edge), continuously, not from a persisted reference to the specific `<a>` element that was clicked. This is what the spec's "endpoints are recomputed... for every connector attached to the panel that moved" already implies, made concrete: nothing about a connector's exact starting pixel is ever stored, which is also what makes URL-state restoration (Task 7) not need its own separate mechanism.
- Backlink and link-interception logic both treat every `<a href>` inside a document's root element the same way, with no special-casing of `data-rel` versus a plain link — consistent with `explore list`'s own "no per-family, no per-attribute special knowledge" discipline.
- This project logs its own decision graph as it works (`CLAUDE.md`, auto-loaded for this repo) — use `pnpm mycelium knowledge add/link/update` as you go, from `experiments/v4/`. This plan's own goal/decision/spec chain already exists: `2026-07-25-xanadu-view-for-docs.goal.html` → `2026-07-25-transpointing-windows-not-graph-diagram.decision.html` → `2026-07-25-write-explore-canvas-rendering-spec.action.html` → `2026-07-25-explore-canvas-rendering.spec.html`. Record one `knowledge-action` per task (or a small group of related tasks) against that chain, and a `knowledge-outcome` once all seven tasks are done and `pnpm validate` passes.
- Verification throughout uses `pnpm mycelium explore serve [--port <n>]` (from `experiments/v4/`) plus a browser, and `curl` for the server-only pieces before a browser is needed. Use a high, unlikely-to-collide port (`--port 4321`) so a stray leftover process from a previous task doesn't block the next one — check for and kill any leftover `node src/run.ts explore serve` process before starting a fresh one if a task's server won't start.

---

### Task 1: HTTP server — static file serving, the `/` route, port handling

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `export async function serve({ fs, args })`, reachable as `mycelium run explore serve [--port <n>]`. `renderExplorePage(treeJson, edgesJson)` — a function later tasks extend in place (same function, growing body) rather than replacing. Task 2 depends on this route existing and on `renderExplorePage`'s signature staying `(treeJson, edgesJson)`.

- [ ] **Step 1: Add the server imports and helpers**

Open `experiments/v4/docs/commands/explore.command.html`. Inside the existing `<script type="mycelium/command">` block, immediately after the closing brace of the `list` command's `export async function list({ fs }) { ... }`, add:

```js

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
}

function serveStatic(req, res, docsDir) {
  const urlPath = decodeURIComponent(req.url.split("?")[0])
  const filePath = resolvePath(docsDir, "." + urlPath)
  if (filePath !== docsDir && !(filePath + sep).startsWith(docsDir + sep)) {
    res.writeHead(403)
    res.end("forbidden")
    return
  }
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    res.writeHead(404)
    res.end("not found")
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404)
    res.end("not found")
    return
  }
  const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream"
  res.writeHead(200, { "content-type": contentType })
  res.end(readFileSync(filePath))
}

function renderExplorePage(treeJson, edgesJson) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Explore: docs/</title>
<link rel="stylesheet" href="/theme.css">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { display: flex; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
</style>
</head>
<body>
<p style="padding:1rem">explore server is running. Sidebar and panels land in later tasks.</p>
<script>
  const TREE = ${treeJson}
  const EDGES = ${edgesJson}
<\/script>
</body>
</html>
`
}

/**
 * Start a local web server rooted at docs/ and render the whole tree as a
 * canvas of connected document panels.
 *
 *   mycelium run explore serve [--port <n>]
 *
 * Any request path maps directly to a file under docs/ and is served as
 * static content, except GET /, which serves a generated shell page. The
 * sidebar tree and the backlink edge list are both computed once, at
 * startup, via fs.list(".") — the same method list already uses — not
 * re-walked on every request: like every other generated artifact in this
 * project, this is a snapshot of the tree at the moment the server starts,
 * not a live view. Runs until interrupted; nothing it does needs cleanup
 * on exit.
 */
export async function serve({ fs, args }) {
  const docsDir = resolvePath("./docs")
  const port = Number(args.port ?? 4321)

  const documents = fs.list(".").map(({ path, doc }) => ({ path, doc }))
  const treeJson = JSON.stringify(buildTree(documents.map((d) => d.path))).replace(/</g, "\\u003c")
  const edgesJson = JSON.stringify(buildEdges(documents)).replace(/</g, "\\u003c")

  const server = createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405)
      res.end("method not allowed")
      return
    }
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(renderExplorePage(treeJson, edgesJson))
      return
    }
    serveStatic(req, res, docsDir)
  })

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`port ${port} is already in use — pass --port to use a different one`)
      process.exit(1)
    }
    throw err
  })

  server.listen(port, () => {
    console.log(`explore server running — open: http://localhost:${port}/`)
  })

  // Never resolves — the command stays alive until the process is killed
  // (Ctrl+C). Nothing here needs cleanup on exit, so no signal handler.
  await new Promise(() => {})
}
```

- [ ] **Step 2: Add `buildTree` and `buildEdges` helpers**

Directly above the `serve` function's own doc comment (so they're defined before use, matching this file's existing top-to-bottom style), add:

```js
// Turns a flat list of docs/-relative paths ("knowledge/foo.html",
// "specs/bar.html", "DESIGN.html") into a nested {name, type, path,
// children} tree for the sidebar. Directory nodes are created on demand
// as paths are inserted; a directory with no ancestor becomes a root-level
// child of the returned array.
function buildTree(paths) {
  const root = []
  for (const path of paths.sort()) {
    const parts = path.split("/")
    let level = root
    let prefix = ""
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]
      prefix = prefix ? `${prefix}/${name}` : name
      const isFile = i === parts.length - 1
      let node = level.find((n) => n.name === name)
      if (!node) {
        node = isFile
          ? { name, type: "file", path: prefix }
          : { name, type: "dir", path: prefix, children: [] }
        level.push(node)
      }
      if (!isFile) level = node.children
    }
  }
  return root
}

// One entry per <a href> found anywhere inside a document's own
// data-conforms-to root, resolved to a docs/-relative path — no
// special-casing of data-rel versus a plain link, matching this tool's
// existing link-interception behavior (Task 4). Used for backlink counts:
// EDGES.filter(e => e.to === path).length is "how many documents link
// here."
function buildEdges(documents) {
  const edges = []
  for (const { path, doc } of documents) {
    // querySelectorAll, not querySelector — a template file can hold more
    // than one live data-conforms-to instance (knowledge.template.html
    // has six sample nodes). explore list's own first version made this
    // same first-match-only mistake and undercounted for exactly this
    // reason; fixed here from the start instead of repeating it.
    for (const root of Array.from(doc.querySelectorAll("[data-conforms-to]"))) {
      for (const a of Array.from(root.querySelectorAll("a[href]"))) {
        const href = a.getAttribute("href")
        if (!href || href.startsWith("http://") || href.startsWith("https://")) continue
        const to = resolvePathRelative(path, href)
        if (to) edges.push({ from: path, to })
      }
    }
  }
  return edges
}

// Resolves an href found inside docs/<fromPath> to another docs/-relative
// path, purely with string/array math (no filesystem access — every
// candidate target either is or isn't already in the known path set,
// checked by the caller if needed). Strips a #fragment first.
function resolvePathRelative(fromPath, href) {
  const clean = href.split("#")[0]
  if (!clean) return null
  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : ""
  const parts = (fromDir ? fromDir.split("/") : []).concat(clean.split("/"))
  const stack = []
  for (const part of parts) {
    if (part === "" || part === ".") continue
    if (part === "..") stack.pop()
    else stack.push(part)
  }
  return stack.join("/")
}
```

- [ ] **Step 3: Add the new imports the server code needs**

`explore.command.html`'s `<script type="mycelium/command">` block currently has no imports at all — `list` doesn't need any. As the very first lines inside that `<script>` tag, before `list`'s doc comment (`/** List every data-conforms-to instance...`), add:

```js
import { createServer } from "node:http"
import { readFileSync, statSync } from "node:fs"
import { extname, resolve as resolvePath, sep } from "node:path"

```

(blank line after, to separate the imports from `list`'s doc comment, matching this project's existing style elsewhere, e.g. `knowledge.template.html`).

- [ ] **Step 4: Verify with curl — no browser needed yet**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321 &`
Then: `sleep 1 && curl -s http://localhost:4321/ | head -5`
Expected: the placeholder HTML from Step 1, including `<p style="padding:1rem">explore server is running...`.

Then: `curl -s http://localhost:4321/theme.css | head -3`
Expected: the real contents of `experiments/v4/docs/theme.css` (starts with `:root {`).

Then: `curl -s -o /dev/null -w "%{http_code}" http://localhost:4321/does-not-exist.html`
Expected: `404`.

Then: `curl -s http://localhost:4321/ | grep -o 'const TREE = .\{1,80\}'`
Expected: a JSON array containing entries like `{"name":"DESIGN.html","type":"file","path":"DESIGN.html"}` and a nested `knowledge` directory node.

Stop the server: `kill %1`

- [ ] **Step 5: Verify the port-in-use path**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321 &`
Then: `sleep 1 && pnpm mycelium explore serve --port 4321`
Expected: the second invocation prints `port 4321 is already in use — pass --port to use a different one` and exits non-zero; the first is still running.
Stop the server: `kill %1`

- [ ] **Step 6: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as before this task, 0 fail — this task only adds command code, no new knowledge/spec instances.

- [ ] **Step 7: Log the action and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement the explore serve command's HTTP server, static file routing, and shell page skeleton" \
  --confidence 80 --status completed --file implement-explore-serve-server
pnpm mycelium knowledge link \
  2026-07-25-implement-explore-serve-server.action.html \
  ../specs/2026-07-25-explore-canvas-rendering.spec.html \
  --rel depends_on --label "implements the server section of this spec"
cd ../..
git add experiments/v4/docs/commands/explore.command.html experiments/v4/docs/knowledge/2026-07-25-implement-explore-serve-server.action.html
git commit -m "experiment(v4): add explore serve — HTTP server, static routing, port handling"
```

---

### Task 2: Panel lifecycle — fetch, shadow root, error state, dedupe

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: the `/` route and `renderExplorePage(treeJson, edgesJson)` from Task 1.
- Produces (inside the generated page's client `<script>`): `openPanel(path, openedFrom)`, `panels` (a `Map<path, {el, x, y, openedFrom}>`), `window.explore = { openPanel, panels }` as a permanent debugging surface (not removed by later tasks — genuinely useful for a dev tool, and what this task uses to test itself before the sidebar exists in Task 3). Task 3 calls `openPanel` from sidebar clicks. Task 4 calls it from link clicks inside a panel and adds connector drawing around it. Task 6 calls it from the backlinks toggle. Task 7 calls it (with explicit x/y) to restore panels from the URL.

- [ ] **Step 1: Replace the placeholder body and add the panel/canvas markup + styles**

In `renderExplorePage`, replace the `<style>...</style>` block and the `<body>` contents with:

```html
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body { display: flex; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  #canvas-wrap { position: relative; flex: 1; overflow: auto; }
  #canvas { position: relative; width: 4000px; height: 4000px; }
  .panel {
    position: absolute; width: 420px; max-height: 480px; display: flex; flex-direction: column;
    border: 1px solid var(--border); border-radius: 8px; background: var(--bg);
    box-shadow: 0 4px 16px rgba(0,0,0,0.25); overflow: hidden;
  }
  .panel-header {
    display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.75rem;
    background: var(--code-bg); border-bottom: 1px solid var(--border); font-size: 0.85rem; gap: 0.5rem;
  }
  .panel-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; color: var(--fg); }
  .panel-close { border: none; background: none; cursor: pointer; font-size: 1rem; color: var(--muted); }
  .panel-content { overflow: auto; }
  .panel-error { padding: 1rem; color: var(--fail); font-size: 0.9rem; }
</style>
</head>
<body>
<div id="canvas-wrap">
  <div id="canvas"></div>
</div>
<script>
  const TREE = ${treeJson}
  const EDGES = ${edgesJson}
  const panels = new Map()
  const canvas = document.getElementById("canvas")
  let cascadeCount = 0

  function panelPosition(openedFrom) {
    if (openedFrom && panels.has(openedFrom)) {
      const parent = panels.get(openedFrom)
      return { x: parent.x + 40, y: parent.y + 40 }
    }
    cascadeCount++
    return { x: 40 + (cascadeCount % 8) * 30, y: 40 + (cascadeCount % 8) * 30 }
  }

  function focusPanel(path) {
    const p = panels.get(path)
    if (!p) return
    canvas.appendChild(p.el) // bring to front
  }

  function showPanelError(el, status) {
    el.querySelector(".panel-content").innerHTML =
      \`<div class="panel-error">Couldn't load this document (\${status || "network error"}).</div>\`
  }

  async function openPanel(path, openedFrom, at) {
    if (panels.has(path)) {
      focusPanel(path)
      return
    }
    const { x, y } = at || panelPosition(openedFrom)
    const el = document.createElement("div")
    el.className = "panel"
    el.style.left = x + "px"
    el.style.top = y + "px"
    el.innerHTML = \`
      <div class="panel-header">
        <span class="panel-title">\${path}</span>
        <button class="panel-close" title="Close">&times;</button>
      </div>
      <div class="panel-content"></div>
    \`
    el.querySelector(".panel-close").addEventListener("click", () => {
      el.remove()
      panels.delete(path)
    })
    canvas.appendChild(el)
    panels.set(path, { el, x, y, openedFrom: openedFrom || null })

    let res
    try {
      res = await fetch("/" + path)
    } catch {
      showPanelError(el, 0)
      return
    }
    if (!res.ok) {
      showPanelError(el, res.status)
      return
    }
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, "text/html")
    const content = el.querySelector(".panel-content")
    const shadow = content.attachShadow({ mode: "open" })
    for (const link of Array.from(doc.head.querySelectorAll("link[rel=stylesheet]"))) {
      const href = new URL(link.getAttribute("href"), res.url).href
      const l = document.createElement("link")
      l.rel = "stylesheet"
      l.href = href
      shadow.appendChild(l)
    }
    const body = document.createElement("div")
    body.innerHTML = doc.body.innerHTML
    shadow.appendChild(body)
    if (doc.title) el.querySelector(".panel-title").textContent = doc.title
  }

  window.explore = { openPanel, panels }
<\/script>
</body>
</html>
\`
}
```

Note the closing of `renderExplorePage`: the function still ends with `` ` }`` — only the template literal's contents changed, not the function wrapper itself.

- [ ] **Step 2: Verify by hand in a browser**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321`
Open `http://localhost:4321/` in a browser.
In the browser devtools console, run: `explore.openPanel("DESIGN.html")`
Expected: a panel appears near the top-left of the canvas, titled with `DESIGN.html`'s real `<title>`, showing `DESIGN.html`'s real rendered content styled by its own stylesheet (readable prose, not unstyled text).

Then run: `explore.openPanel("DESIGN.html")` again.
Expected: no second panel appears — the existing one is brought to front (no visible change if it was already on top).

Then run: `explore.openPanel("knowledge/2026-07-25-does-not-exist.html")`
Expected: a panel appears showing "Couldn't load this document (404)." in red, not a broken/empty panel.

Click the panel's close button.
Expected: the panel is removed from the page, and `explore.panels.size` in the console reflects one fewer entry.

Stop the server with Ctrl+C.

- [ ] **Step 3: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as after Task 1, 0 fail.

- [ ] **Step 4: Log the action and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement explore serve's panel lifecycle: fetch, shadow-root loading, dedupe, inline error state" \
  --confidence 80 --status completed --file implement-explore-panel-lifecycle
cd ../..
git add experiments/v4/docs/commands/explore.command.html experiments/v4/docs/knowledge/2026-07-25-implement-explore-panel-lifecycle.action.html
git commit -m "experiment(v4): explore serve renders real document panels into shadow roots"
```

---

### Task 3: Sidebar

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: `TREE`, `openPanel(path, openedFrom)` from Task 2.
- Produces: a rendered, clickable file tree; no new function other consuming tasks need by name.

- [ ] **Step 1: Add sidebar markup and styles**

In `renderExplorePage`'s `<style>` block, add:

```css
  #sidebar {
    width: 260px; flex: none; overflow-y: auto; border-right: 1px solid var(--border);
    padding: 1rem; box-sizing: border-box; background: var(--code-bg); font-size: 0.85rem;
  }
  .tree-dir > .tree-label { font-weight: 600; cursor: pointer; margin: 0.15rem 0; }
  .tree-file { cursor: pointer; color: var(--accent); margin: 0.15rem 0; display: block; }
  .tree-children { margin-left: 1rem; }
  .tree-children.collapsed { display: none; }
```

Change `<div id="canvas-wrap">` to be preceded by a sidebar element — the body becomes:

```html
<body>
<nav id="sidebar"></nav>
<div id="canvas-wrap">
  <div id="canvas"></div>
</div>
```

- [ ] **Step 2: Add the tree-rendering script**

Immediately after the `window.explore = { openPanel, panels }` line, add:

```js

  function renderTree(nodes, container) {
    for (const node of nodes) {
      if (node.type === "file") {
        const a = document.createElement("a")
        a.className = "tree-file"
        a.textContent = node.name
        a.href = "#"
        a.addEventListener("click", (e) => {
          e.preventDefault()
          openPanel(node.path)
        })
        container.appendChild(a)
      } else {
        const dir = document.createElement("div")
        dir.className = "tree-dir"
        const label = document.createElement("div")
        label.className = "tree-label"
        label.textContent = node.name + "/"
        const children = document.createElement("div")
        children.className = "tree-children"
        label.addEventListener("click", () => children.classList.toggle("collapsed"))
        dir.appendChild(label)
        dir.appendChild(children)
        container.appendChild(dir)
        renderTree(node.children, children)
      }
    }
  }
  renderTree(TREE, document.getElementById("sidebar"))
```

- [ ] **Step 3: Verify by hand in a browser**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321`
Open `http://localhost:4321/`.
Expected: a left sidebar lists `DESIGN.html`, `theme.css` is absent from the *clickable* tree only in the sense that it's still listed (the tree includes every file under docs/, `.css` included) — clicking it will 404 in the panel, which is acceptable for this task; directories (`knowledge/`, `specs/`, `templates/`, `commands/`) appear as bold, clickable-to-collapse labels.
Click `knowledge/` — its children expand/collapse.
Click any file inside `knowledge/`.
Expected: a panel opens for that file, same as `explore.openPanel(...)` did manually in Task 2.
Click the same file again in the sidebar.
Expected: no duplicate panel; the existing one comes to front.

Stop the server with Ctrl+C.

- [ ] **Step 4: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as after Task 2, 0 fail.

- [ ] **Step 5: Log the action and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement explore serve's sidebar — collapsible file tree wired to openPanel" \
  --confidence 80 --status completed --file implement-explore-sidebar
cd ../..
git add experiments/v4/docs/commands/explore.command.html experiments/v4/docs/knowledge/2026-07-25-implement-explore-sidebar.action.html
git commit -m "experiment(v4): explore serve grows a sidebar for browsing docs/"
```

---

### Task 4: Link interception + connector layer

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: `panels`, `openPanel(path, openedFrom)` from Task 2.
- Produces: `drawConnector(fromPath, toPath)`, `updateConnectorsFor(path)`, a `connectors` array of `{from, to, line}`. Task 5 calls `updateConnectorsFor` on drag. Task 6 calls `drawConnector` for backlink opens. Task 7 calls `drawConnector` while restoring panels.

- [ ] **Step 1: Add the SVG connector layer to the markup and styles**

In the `<style>` block, add:

```css
  #connectors { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
  #connectors line { stroke: var(--accent); stroke-width: 1.5; }
```

Change `<div id="canvas"></div>` to:

```html
  <div id="canvas">
    <svg id="connectors"></svg>
  </div>
```

- [ ] **Step 2: Add connector drawing + recomputation, and wire link clicks**

Add this after the `panels`/`canvas` declarations near the top of the script (before `panelPosition`, since `openPanel` in the next edit calls into this):

```js
  const svg = document.getElementById("connectors")
  const connectors = [] // { from, to, line }

  function edgePoint(rect, towardRect) {
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const tx = towardRect.left + towardRect.width / 2
    const ty = towardRect.top + towardRect.height / 2
    const dx = tx - cx
    const dy = ty - cy
    if (dx === 0 && dy === 0) return { x: cx, y: cy }
    const scaleX = dx !== 0 ? (rect.width / 2) / Math.abs(dx) : Infinity
    const scaleY = dy !== 0 ? (rect.height / 2) / Math.abs(dy) : Infinity
    const scale = Math.min(scaleX, scaleY)
    return { x: cx + dx * scale, y: cy + dy * scale }
  }

  function positionLine(line, fromPath, toPath) {
    const fromEl = panels.get(fromPath)?.el
    const toEl = panels.get(toPath)?.el
    if (!fromEl || !toEl) return
    const canvasRect = canvas.getBoundingClientRect()
    const fromRect = fromEl.getBoundingClientRect()
    const toRect = toEl.getBoundingClientRect()
    const start = edgePoint(fromRect, toRect)
    const end = edgePoint(toRect, fromRect)
    line.setAttribute("x1", start.x - canvasRect.left)
    line.setAttribute("y1", start.y - canvasRect.top)
    line.setAttribute("x2", end.x - canvasRect.left)
    line.setAttribute("y2", end.y - canvasRect.top)
  }

  function drawConnector(fromPath, toPath) {
    if (!fromPath || !toPath) return
    if (connectors.some((c) => c.from === fromPath && c.to === toPath)) return
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line")
    svg.appendChild(line)
    connectors.push({ from: fromPath, to: toPath, line })
    positionLine(line, fromPath, toPath)
  }

  function updateConnectorsFor(path) {
    for (const c of connectors) {
      if (c.from === path || c.to === path) positionLine(c.line, c.from, c.to)
    }
  }
```

- [ ] **Step 3: Draw a connector whenever a panel is opened with a parent, and intercept link clicks**

In `openPanel`, immediately after `panels.set(path, { el, x, y, openedFrom: openedFrom || null })`, add:

```js
    if (openedFrom) drawConnector(openedFrom, path)
```

Then, after the stylesheet-linking loop and before `if (doc.title) ...`, add the link-interception listener (attached to the shadow root so it catches every click inside the loaded content):

```js
    shadow.addEventListener("click", (e) => {
      const a = e.composedPath().find((n) => n.tagName === "A" && n.hasAttribute("href"))
      if (!a) return
      const href = a.getAttribute("href")
      if (href.startsWith("http://") || href.startsWith("https://")) return
      e.preventDefault()
      const targetPath = resolvePathRelativeClient(path, href)
      openPanel(targetPath, path)
    })
```

Add the client-side counterpart of the server's path resolver (same logic, browser-side, no filesystem involved either way) directly above `openPanel`:

```js
  function resolvePathRelativeClient(fromPath, href) {
    const clean = href.split("#")[0]
    const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : ""
    const parts = (fromDir ? fromDir.split("/") : []).concat(clean.split("/"))
    const stack = []
    for (const part of parts) {
      if (part === "" || part === ".") continue
      if (part === "..") stack.pop()
      else stack.push(part)
    }
    return stack.join("/")
  }
```

- [ ] **Step 4: Verify by hand in a browser**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321`
Open `http://localhost:4321/` and open, from the sidebar, a `knowledge-decision` file known to contain at least one `<a data-rel>` link — e.g. `knowledge/2026-07-25-drop-html-head-body-keep-doctype-charset.decision.html` (links to `2026-07-23-html-as-store.decision.html` and `2026-07-25-shadow-dom-panel-isolation.decision.html`).
Click one of the links rendered inside that panel.
Expected: the page does not navigate away; a new panel opens near the first one, and a line is drawn connecting the two panels.
Drag neither panel yet (Task 5) — just confirm the line's endpoints touch the two panels' borders, not their centers, and not empty/NaN coordinates (check via devtools that the `<line>` element has non-empty `x1/y1/x2/y2` attributes).

Stop the server with Ctrl+C.

- [ ] **Step 5: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as after Task 3, 0 fail.

- [ ] **Step 6: Log the action and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement explore serve's link interception and SVG connector layer" \
  --confidence 80 --status completed --file implement-explore-connectors
cd ../..
git add experiments/v4/docs/commands/explore.command.html experiments/v4/docs/knowledge/2026-07-25-implement-explore-connectors.action.html
git commit -m "experiment(v4): explore serve opens connected panels on link click"
```

---

### Task 5: Dragging + live connector recomputation

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: `panels`, `updateConnectorsFor(path)` from Task 4.
- Produces: dragging updates `panels.get(path).x/y`; exposes `onPanelDragEnd` as a hook (an array of callback functions, `dragEndListeners`) that Task 7 appends to for debounced URL-state saving, without Task 5 needing to know Task 7 exists yet.

- [ ] **Step 1: Make the header draggable**

In `openPanel`, right after `canvas.appendChild(el)` (before the `fetch` call — dragging shouldn't wait on content loading), add:

```js
    makeDraggable(el, path)
```

Add `makeDraggable` and the drag-end listener registry above `openPanel`:

```js
  const dragEndListeners = []

  function makeDraggable(el, path) {
    const header = el.querySelector(".panel-header")
    header.style.cursor = "grab"
    header.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".panel-close")) return
      e.preventDefault()
      header.setPointerCapture(e.pointerId)
      header.style.cursor = "grabbing"
      const startX = e.clientX
      const startY = e.clientY
      const state = panels.get(path)
      const originX = state.x
      const originY = state.y

      function onMove(ev) {
        state.x = originX + (ev.clientX - startX)
        state.y = originY + (ev.clientY - startY)
        el.style.left = state.x + "px"
        el.style.top = state.y + "px"
        updateConnectorsFor(path)
      }
      function onUp() {
        header.style.cursor = "grab"
        header.removeEventListener("pointermove", onMove)
        header.removeEventListener("pointerup", onUp)
        for (const fn of dragEndListeners) fn(path)
      }
      header.addEventListener("pointermove", onMove)
      header.addEventListener("pointerup", onUp)
    })
  }
```

- [ ] **Step 2: Recompute connectors on window resize too**

Near the end of the script, before `renderTree(TREE, ...)`, add:

```js
  window.addEventListener("resize", () => {
    for (const path of panels.keys()) updateConnectorsFor(path)
  })
```

- [ ] **Step 3: Verify by hand in a browser**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321`
Repeat Task 4's verification (open a panel with a link, click the link to open a connected second panel).
Drag the first panel by its header to a new position.
Expected: the panel moves, and the connector line's endpoint on that panel's side moves with it in real time (not just after releasing the mouse).
Resize the browser window.
Expected: connector lines stay attached to both panels (no visible drift).

Stop the server with Ctrl+C.

- [ ] **Step 4: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as after Task 4, 0 fail.

- [ ] **Step 5: Log the action and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement explore serve's panel dragging with live connector recomputation" \
  --confidence 80 --status completed --file implement-explore-dragging
cd ../..
git add experiments/v4/docs/commands/explore.command.html experiments/v4/docs/knowledge/2026-07-25-implement-explore-dragging.action.html
git commit -m "experiment(v4): explore serve panels are draggable, connectors follow"
```

---

### Task 6: Backlinks

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: `EDGES` (from Task 1's `buildEdges`), `panels`, `openPanel`, `drawConnector` from Task 4.
- Produces: a backlinks toggle in every panel header; no new function other tasks need by name.

- [ ] **Step 1: Add the backlinks button to panel markup and styles**

In the `<style>` block, add:

```css
  .panel-backlinks { border: none; background: none; cursor: pointer; font-size: 0.75rem; color: var(--muted); white-space: nowrap; }
  .panel-backlinks:disabled { opacity: 0.4; cursor: default; }
```

In `openPanel`'s header markup, change:

```html
      <div class="panel-header">
        <span class="panel-title">\${path}</span>
        <button class="panel-close" title="Close">&times;</button>
      </div>
```

to:

```html
      <div class="panel-header">
        <span class="panel-title">\${path}</span>
        <button class="panel-backlinks" title="Documents linking here"></button>
        <button class="panel-close" title="Close">&times;</button>
      </div>
```

- [ ] **Step 2: Wire the button up**

After the `if (doc.title) el.querySelector(".panel-title").textContent = doc.title` line inside `openPanel`, add:

```js
    const backlinkPaths = EDGES.filter((e) => e.to === path).map((e) => e.from)
    const backlinksBtn = el.querySelector(".panel-backlinks")
    backlinksBtn.textContent = backlinkPaths.length + (backlinkPaths.length === 1 ? " backlink" : " backlinks")
    if (backlinkPaths.length === 0) {
      backlinksBtn.disabled = true
    } else {
      backlinksBtn.addEventListener("click", () => {
        for (const from of backlinkPaths) openPanel(from, path)
      })
    }
```

- [ ] **Step 3: Verify by hand in a browser**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321`
Open `knowledge/2026-07-23-html-as-store.decision.html` from the sidebar (a real node several other files link to, e.g. `2026-07-25-drop-html-head-body-keep-doctype-charset.decision.html` via `elaborates`).
Expected: its header shows a backlinks count of 1 or more, as an enabled button.
Click it.
Expected: one panel per backlinking document opens, each connected to the original panel by a line.
Open a panel for a document with no backlinks (a fresh leaf node with nothing pointing at it).
Expected: its button reads "0 backlinks" and is disabled (not clickable).

Stop the server with Ctrl+C.

- [ ] **Step 4: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as after Task 5, 0 fail.

- [ ] **Step 5: Log the action, link it back to why backlinks matter, and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement explore serve's backlinks — inbound link count and open-all toggle per panel" \
  --confidence 80 --status completed --file implement-explore-backlinks
pnpm mycelium knowledge link \
  2026-07-25-implement-explore-backlinks.action.html \
  2026-07-25-docs-link-web-and-orphaned-design-html.observation.html \
  --rel depends_on --label "the observation that made bidirectional visibility the point of this tool"
cd ../..
git add experiments/v4/docs/commands/explore.command.html experiments/v4/docs/knowledge/2026-07-25-implement-explore-backlinks.action.html
git commit -m "experiment(v4): explore serve shows and opens backlinks per panel"
```

---

### Task 7: URL state — persist and restore canvas layout

**Files:**
- Modify: `experiments/v4/docs/commands/explore.command.html`

**Interfaces:**
- Consumes: `panels`, `openPanel`, `drawConnector`, `dragEndListeners` from earlier tasks.
- Produces: `saveState()`, `restoreState()`. Nothing later depends on these — this is the last task.

- [ ] **Step 1: Add save/restore functions**

Near the end of the script, before `renderTree(TREE, ...)`, add:

```js
  function saveState() {
    const state = Array.from(panels.entries()).map(([path, p]) => ({
      path, x: Math.round(p.x), y: Math.round(p.y), from: p.openedFrom,
    }))
    history.replaceState(null, "", "#" + encodeURIComponent(JSON.stringify(state)))
  }

  async function restoreState() {
    if (!location.hash) return
    let state
    try {
      state = JSON.parse(decodeURIComponent(location.hash.slice(1)))
    } catch {
      return
    }
    // Open in the order panels were saved so a panel's "from" is already
    // open (or absent) by the time it's restored — openPanel draws its
    // connector immediately if openedFrom is already in `panels`.
    for (const p of state) {
      await openPanel(p.path, p.from, { x: p.x, y: p.y })
    }
  }
```

- [ ] **Step 2: Call `saveState` on open, close, and drag-end**

In `openPanel`, at the very end of the function (after the backlinks wiring from Task 6), add:

```js
    saveState()
```

In the close-button listener inside `openPanel`, add a call after `panels.delete(path)`:

```js
    el.querySelector(".panel-close").addEventListener("click", () => {
      el.remove()
      panels.delete(path)
      saveState()
    })
```

(This replaces the close-button listener body added in Task 2 — same listener, one added line.)

Task 5's `makeDraggable` already calls every function in `dragEndListeners` on drag-end, so no edit to `onUp` itself is needed — register `saveState` as a listener instead. Add this line directly after the `restoreState` function definition (Step 1, above):

```js
  dragEndListeners.push(saveState)
```

- [ ] **Step 3: Restore on load**

Replace the final line of the script, `renderTree(TREE, document.getElementById("sidebar"))`, with:

```js
  renderTree(TREE, document.getElementById("sidebar"))
  restoreState()
```

- [ ] **Step 4: Verify by hand in a browser**

Run: `cd experiments/v4 && pnpm mycelium explore serve --port 4321`
Open `http://localhost:4321/`, open two connected panels (a document and one of its links), drag one of them to a new spot.
Expected: the URL's hash fragment now contains a JSON-shaped value (check the browser's address bar or `location.hash` in devtools).
Reload the page (full page reload, not just re-navigating).
Expected: both panels reopen automatically, in their dragged positions, with the connector between them redrawn — no empty canvas, no re-clicking required.
Copy the URL, open it in a new private/incognito window.
Expected: the same layout appears there too.
Close one panel.
Expected: the hash updates to no longer include it; reloading again does not bring it back.

Stop the server with Ctrl+C.

- [ ] **Step 5: `pnpm validate` stays clean**

Run: `cd experiments/v4 && pnpm validate`
Expected: same pass count as after Task 6, 0 fail.

- [ ] **Step 6: Log the action, close out the goal chain, and commit**

```bash
cd experiments/v4
pnpm mycelium knowledge add action \
  --title "Implement explore serve's URL-hash canvas state persistence and restore" \
  --confidence 80 --status completed --file implement-explore-url-state
pnpm mycelium knowledge add outcome \
  --title "Panel and connector rendering for the docs/ explorer is implemented end to end and pnpm validate stays clean throughout" \
  --confidence 80 --file explore-canvas-rendering-shipped
pnpm mycelium knowledge link \
  2026-07-25-implement-explore-url-state.action.html \
  2026-07-25-explore-canvas-rendering-shipped.outcome.html \
  --rel leads_to --label "the last task, closing out the spec"
pnpm mycelium knowledge link \
  2026-07-25-xanadu-view-for-docs.goal.html \
  2026-07-25-explore-canvas-rendering-shipped.outcome.html \
  --rel leads_to --label "the root goal this outcome resolves"
pnpm mycelium knowledge update 2026-07-25-xanadu-view-for-docs.goal.html --status completed
cd ../..
git add experiments/v4/docs/commands/explore.command.html \
  experiments/v4/docs/knowledge/2026-07-25-implement-explore-url-state.action.html \
  experiments/v4/docs/knowledge/2026-07-25-explore-canvas-rendering-shipped.outcome.html \
  experiments/v4/docs/knowledge/2026-07-25-xanadu-view-for-docs.goal.html
git commit -m "experiment(v4): explore serve persists and restores canvas layout via the URL"
```
