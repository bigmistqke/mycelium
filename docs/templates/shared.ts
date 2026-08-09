// Shared across template-embedded command scripts — importable now that
// script-hooks.ts gives every embedded <script> a real file: identity
// instead of a data: URL. This is the first real instance of the sharing
// docs/knowledge/2026-07-24-duplicate-not-share-loadcheck.decision.html
// declined at a much smaller scale. That decision's own stated reason
// ("a data: URL-loaded command script can't do a relative import
// anyway") no longer holds once the script itself loads from a real
// file: URL. See docs/specs/2026-07-25-virtual-module-script-imports.spec.html.

export function todayDate(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The tags a type declares, in the order it declares them.
 *
 * Reads the shape out of the template rather than repeating it, so a field
 * added to a template needs no second edit here.
 */
export function declaredOrder(templateDoc: Document, typeId: string): string[] {
  const tpl = templateDoc.querySelector(`template[id="${typeId}"]`) as HTMLTemplateElement | null
  const shape = tpl?.content?.firstElementChild
  return shape ? Array.from(shape.children).map((c) => c.tagName.toLowerCase()) : []
}

/**
 * Every type a template file declares, mapped to the order of its fields.
 *
 * A family nesting several types needs all of them at once, and reading them
 * together means a command never names its own types in code.
 */
export function declaredOrders(templateDoc: Document): Map<string, string[]> {
  const orders = new Map<string, string[]>()
  for (const tpl of Array.from(templateDoc.querySelectorAll("template[id]"))) {
    const id = tpl.getAttribute("id")!
    orders.set(id, declaredOrder(templateDoc, id))
  }
  return orders
}

/**
 * Puts a new field where its template declares it, rather than last.
 *
 * Appending records which flag arrived when. Two nodes saying the same thing
 * then serialize differently, and 31 nodes in this corpus drifted that way,
 * one `update` at a time. It also blocks enforcing the declared order later,
 * since every node an update had touched would fail.
 *
 * A tag the template does not declare keeps its place. An edge or a script
 * never moves, and declared fields only ever move relative to each other.
 */
export function placeField(root: Element, el: Element, order: string[]): void {
  const rank = order.indexOf(el.tagName.toLowerCase())
  const later =
    rank < 0
      ? null
      : Array.from(root.children).find((c) => order.indexOf(c.tagName.toLowerCase()) > rank)
  root.insertBefore(el, later ?? null)
}

/**
 * Whether a document declares types rather than making claims.
 *
 * An instance inside one demonstrates its type and asserts nothing about the
 * system, so anything counting or drawing the corpus skips it. Nothing marks
 * one: the document it sits in says so, and a marker would be a hand-written
 * copy of that with somewhere to forget it.
 *
 * validate still checks every worked example, since conforming is half their
 * job. This answers a different question.
 */
export function declaresATemplate(doc: Document): boolean {
  return doc.querySelector("template[id]") !== null
}
