// Shared across template-embedded command scripts — importable now that
// script-hooks.ts gives every embedded <script> a real file: identity
// instead of a data: URL. First real instance of the sharing
// docs/knowledge/2026-07-24-duplicate-not-share-loadcheck.decision.html
// declined at a much smaller scale: that decision's own stated reason
// ("a data: URL-loaded command script can't do a relative import
// anyway") no longer holds once the script itself loads from a real
// file: URL. See docs/specs/2026-07-25-virtual-module-script-imports.spec.html.

export function todayDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
