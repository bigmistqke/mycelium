// The VS Code half: starts editor/server.ts and points it at HTML files.
//
// CommonJS, and in its own directory with its own package.json, because the
// extension host loads this while the server beside it is an ES module running
// under Node's own type stripping. Keeping the two module systems in separate
// directories is cheaper than making either one bend.

const path = require("node:path")
const { workspace, window } = require("vscode")
const { LanguageClient, TransportKind } = require("vscode-languageclient/node")

let client

function serverPath() {
  const configured = workspace.getConfiguration("mycelium").get("server.path")
  return configured && configured.length > 0 ? configured : path.join(__dirname, "..", "server.ts")
}

function activate(context) {
  const module = serverPath()

  // The server is TypeScript run directly. Node 24 strips types itself, so
  // there is no build step here and nothing to keep in sync with the sources —
  // the same property the rest of this project relies on.
  const run = {
    module,
    transport: TransportKind.stdio,
    options: { execArgv: [] },
  }

  client = new LanguageClient(
    "mycelium",
    "Mycelium",
    { run, debug: run },
    {
      documentSelector: [{ scheme: "file", language: "html" }],
      synchronize: { fileEvents: workspace.createFileSystemWatcher("**/*.{html,ts}") },
      outputChannel: window.createOutputChannel("Mycelium"),
    },
  )

  context.subscriptions.push(client)
  client.start().catch((err) => {
    window.showErrorMessage(`Mycelium language server failed to start: ${err.message}`)
  })
}

function deactivate() {
  return client?.stop()
}

module.exports = { activate, deactivate }
