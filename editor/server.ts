// The language server. Speaks LSP over stdio and serves this project's HTML
// documents through the language plugin beside this file.
//
// Everything it knows about this project is in that plugin: which script types
// are Node-only, and that a block is the unit rather than a file. This part is
// the standard Volar wiring, kept separate so something else can run the
// plugin without a server — editor/check.ts does exactly that.

import { createConnection, createServer, createTypeScriptProject } from "@volar/language-server/node.js"
import { create as createTypeScriptServices } from "volar-service-typescript"
import * as ts from "typescript"
import { createMyceliumLanguagePlugin } from "./language-plugin.ts"

const connection = createConnection()
const server = createServer(connection)

connection.listen()

connection.onInitialize((params) =>
  server.initialize(
    params,
    createTypeScriptProject(ts, undefined, () => ({
      languagePlugins: [createMyceliumLanguagePlugin(ts)],
    })),
    createTypeScriptServices(ts),
  ),
)

connection.onInitialized(() => {
  server.initialized()
  // Watch both, not just the HTML. A command block imports ../../src/api.ts and
  // ./extract-graph.ts, so a change to either has to invalidate the documents
  // that import it.
  server.fileWatcher.watchFiles(["**/*.{html,ts}"])
})
