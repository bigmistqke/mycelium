// Shared between the crawler (Node) and browser-facing live demos. Real ES
// module, imported normally by both — which means anything using it needs
// to be served over http://, not opened via file://. ES module fetches are
// CORS-checked even for local files, and file:// URLs don't have a stable
// origin to satisfy that check; classic (non-module) scripts and data:
// imports are exempt, but real import/export syntax is worth the small
// server requirement over hand-duplicating this in every script that needs
// it. See docs/specs/2026-07-23-mycelium-crawler.spec.html.

export async function loadCheck(scriptSource) {
  const mod = await import(`data:text/javascript,${encodeURIComponent(scriptSource)}`)
  return mod.check
}
