// A ranked graph, held open: the same page graphPage builds, served over
// HTTP and redrawn in the reader's own tab whenever the corpus underneath it
// moves.
//
// Nothing here knows what it is drawing, the same way graph-page.ts does not.
// A caller hands over which files to watch and how to rebuild its data when
// one of them changes; everything after that — the HTTP server, the change
// channel, deciding whether a change swaps data or forces a reload — is one
// piece shared by every family that draws a graph.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { watch, readFileSync, existsSync, statSync } from "node:fs"
import { basename, dirname, extname, resolve as resolvePath } from "node:path"
import { spawn } from "node:child_process"
import { platform } from "node:process"
import { graphPage, type GraphPage } from "./graph-page.ts"

export interface GraphData {
  data: unknown
  counts: string
  /** How many edges leaving the drawing's own kind got dropped, for a note worth logging once. */
  dropped?: number
}

export interface ServeGraphOptions {
  /** What graphPage always needs, minus the parts that change on every rebuild or only apply to a written file. */
  page: Omit<GraphPage, "data" | "counts" | "base" | "scripts" | "hmrClient">
  /** Absolute path to the shared drawing engine, graph.element.js. */
  sharedScriptPath: string
  /** Absolute path to the family's own ranking script — the one that calls the shared engine. */
  rankingScriptPath: string
  /** Absolute path to graph.template.css. */
  cssPath: string
  /** Absolute path to the corpus, served at "/" so a node's own link opens the real file. */
  corpusRoot: string
  /** Where the family's own documents live, relative to corpusRoot. Any change inside rebuilds. */
  watchDir: string
  build: () => GraphData
  port?: number
  open?: boolean
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
}

function openBrowser(url: string) {
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open"
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref()
}

/**
 * The client half of the change channel, inlined into the page as one more
 * script.
 *
 * Kept here rather than as a file beside graph.element.js: it is protocol,
 * not drawing, and it has no life outside this exact server — nothing else
 * ever loads it or checks it on its own.
 */
function hmrClient(rankingScriptName: string, dataId: string): string {
  return `(function () {
  var source = new EventSource('/_hmr')
  source.onmessage = function (event) {
    var msg = JSON.parse(event.data)
    if (msg.kind === 'reload') { location.reload(); return }
    if (msg.kind === 'css') {
      document.getElementById('graph-style').textContent = msg.css
      return
    }
    if (msg.kind === 'data') {
      document.getElementById('${dataId}').textContent = JSON.stringify(msg.data)
      document.querySelector('.counts').innerHTML =
        msg.counts + '<span class="stat"> &middot; <b id="crossings">—</b> wires over boxes</span>'
      var tag = document.querySelector('script[data-src="${rankingScriptName}"]')
      tag.textContent = msg.script
      new Function(msg.script)()
    }
  }
})()`
}

function serveStatic(req: IncomingMessage, res: ServerResponse, root: string) {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0].split("#")[0])
  const full = resolvePath(root, "." + url)
  // A path climbing above the corpus root is refused rather than resolved —
  // the same rule a request from outside the corpus would meet anywhere else.
  if (!full.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return }
  if (!existsSync(full) || !statSync(full).isFile()) { res.writeHead(404); res.end("not found"); return }
  res.writeHead(200, { "content-type": MIME[extname(full)] ?? "application/octet-stream" })
  res.end(readFileSync(full))
}

/**
 * Serve a graph, and keep serving it as the corpus it draws changes.
 *
 * Runs until interrupted. Every GET / rebuilds and redraws fresh — a rebuild
 * costs about a second on this corpus, most of it the engine's own startup
 * that a long-lived process pays once rather than per request, and a single
 * reader opening the page is not where that second would be missed.
 */
export async function serveGraph(options: ServeGraphOptions): Promise<never> {
  const port = options.port ?? 4322
  let lastDropped: number | undefined

  const sharedName = basename(options.sharedScriptPath)
  const rankingName = basename(options.rankingScriptPath)

  const rebuild = () => {
    const { data, counts, dropped } = options.build()
    if (dropped !== undefined && dropped !== lastDropped) {
      console.log(`note: ${dropped} edge(s) leaving the drawing are not drawn`)
      lastDropped = dropped
    }
    return { data, counts }
  }

  const buildPage = () => {
    const { data, counts } = rebuild()
    return graphPage({
      ...options.page,
      data,
      counts,
      scripts: [
        { name: sharedName, source: readFileSync(options.sharedScriptPath, "utf8") },
        { name: rankingName, source: readFileSync(options.rankingScriptPath, "utf8") },
      ],
      hmrClient: hmrClient(rankingName, options.page.dataId),
    })
  }

  const subscribers = new Set<ServerResponse>()
  const send = (msg: unknown) => {
    const line = `data: ${JSON.stringify(msg)}\n\n`
    for (const res of subscribers) res.write(line)
  }

  const server = createServer((req, res) => {
    if (req.method !== "GET") { res.writeHead(405); res.end("method not allowed"); return }
    if (req.url === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(buildPage())
      return
    }
    if (req.url === "/_hmr") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.write(":\n\n")
      subscribers.add(res)
      req.on("close", () => subscribers.delete(res))
      return
    }
    serveStatic(req, res, options.corpusRoot)
  })

  // What kind of change each watched path names, decided once rather than on
  // every event. A watched directory can hold more than one of these, and an
  // event with no filename — a platform limitation, not a rare one — cannot
  // say which; touching every kind possible in that directory is the safe
  // reading of "something changed and I cannot say what."
  const kindOf = new Map<string, "shared" | "ranking" | "css">([
    [options.sharedScriptPath, "shared"],
    [options.rankingScriptPath, "ranking"],
    [options.cssPath, "css"],
  ])
  const corpusWatchDir = resolvePath(options.corpusRoot, options.watchDir)

  let touched = { doc: false, css: false, ranking: false, shared: false }
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    timer = undefined
    const doing = touched
    touched = { doc: false, css: false, ranking: false, shared: false }
    if (doing.shared) { send({ kind: "reload" }); return }
    if (doing.css) send({ kind: "css", css: readFileSync(options.cssPath, "utf8") })
    if (doing.doc || doing.ranking) {
      const { data, counts } = rebuild()
      send({ kind: "data", data, counts, script: readFileSync(options.rankingScriptPath, "utf8") })
    }
  }

  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(flush, 250)
  }

  const watchedDirs = new Set([
    dirname(options.sharedScriptPath),
    dirname(options.rankingScriptPath),
    dirname(options.cssPath),
    corpusWatchDir,
  ])
  for (const dir of watchedDirs) {
    watch(dir, (_event, filename) => {
      if (dir === corpusWatchDir) { touched.doc = true; schedule(); return }
      const full = filename ? resolvePath(dir, filename) : null
      const kind = full ? kindOf.get(full) : undefined
      if (kind) { touched[kind] = true; schedule(); return }
      // No filename, or a file in this directory nothing here watches by
      // name (an editor's swap file, say). Touch every kind this directory
      // could mean rather than guess wrong and stay silent.
      for (const [path, k] of kindOf) if (dirname(path) === dir) touched[k] = true
      schedule()
    })
  }

  await new Promise<void>((_resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        console.error(`port ${port} is already in use — pass --port to use a different one`)
        process.exit(1)
      }
      reject(err)
    })
    server.listen(port, () => {
      const url = `http://localhost:${port}/`
      console.log(`serving — open: ${url}`)
      if (options.open) openBrowser(url)
    })
  })
  // Unreachable: the promise above only settles by throwing. The server runs
  // until the process is killed, the same way explore's own planned serve does.
  throw new Error("unreachable")
}
