// Shared between the crawler (Node) and browser-facing live demos. No
// `export` on purpose: real ES module imports are CORS-checked even for
// local files, and file:// has no stable origin to satisfy that check, so
// a normal `import` here would break every document that opened this way
// — exactly the thing this project keeps proving out loud. A classic
// (non-module) <script src> and a Node side-effect `import` both work over
// file://, and both see the same globalThis, so this file is loaded
// identically both ways: <script src="…/runtime.js"></script> in a
// browser, `import "./runtime.js"` in validate.ts. See
// docs/specs/2026-07-23-mycelium-crawler.spec.html.

globalThis.mycelium = globalThis.mycelium || {}

globalThis.mycelium.loadModule = async function loadModule(scriptSource) {
  return await import(`data:text/javascript,${encodeURIComponent(scriptSource)}`)
}

globalThis.mycelium.loadCheck = async function loadCheck(scriptSource) {
  const mod = await globalThis.mycelium.loadModule(scriptSource)
  return mod.check
}
