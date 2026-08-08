// A corpus an audit can read, held in memory, and the audits themselves.
//
// An audit is a function of a corpus: check(fs) hands back what it found, and
// AuditFs is the whole of what it needs — list, read and parse. So a case
// builds one of those over a map of documents and calls the check. No
// temporary directory, and no second process.
//
// The check still comes out of the document declaring it, through the module
// hook validate itself uses, so a case runs the real audit and not a copy of
// one. That is what the hook is for: a script inside a document becomes an
// importable module without anybody extracting it to a file.

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { loadCheck, loadGenericValidator, parseHTML, resolveTemplateRef } from "../../src/utils.ts"
import type { AuditFs, AuditResult } from "../../src/api.ts"

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const TEMPLATES = resolve(DOCS, "templates")

type Check = (fs: AuditFs) => AuditResult | Promise<AuditResult>

// One audit, by the name it declares in data-audits.
export async function auditNamed(template: string, name: string): Promise<Check> {
  const file = resolve(TEMPLATES, template)
  const { document } = parseHTML(readFileSync(file, "utf8"))
  const script = document.querySelector(`script[data-audits="${name}"]`)
  if (!script) throw new Error(`no audit named "${name}" in ${template}`)
  return (await loadCheck(file, script)) as Check
}

// Every fixture document, checked against the template it claims, by the same
// validator validate runs.
//
// This is what a corpus in memory costs. The builders below write markup by
// hand, so nothing stops them describing a shape the real commands stopped
// writing months ago, and a case would go on passing against that. Reading the
// real template closes most of it: a field this family renamed, reordered,
// stopped allowing or never declared fails here rather than passing quietly.
//
// What it still cannot see is a change the schema permits — a command that
// starts writing an extra wrapper, or picks a different directory. Those need a
// case that runs the real command.
async function assertConforming(documents: Record<string, string>) {
  const check = await loadGenericValidator(DOCS)
  for (const [path, markup] of Object.entries(documents)) {
    const { document } = parseHTML(markup)
    for (const instance of Array.from(document.querySelectorAll("[data-conforms-to]"))) {
      const conformsTo = instance.getAttribute("data-conforms-to") ?? ""
      const [file, id] = resolveTemplateRef(resolve(DOCS, "..", path), conformsTo).split("#")
      const template = parseHTML(readFileSync(file, "utf8")).document.querySelector(`template[id="${id}"]`)
      if (!template) throw new Error(`${path}: no template at ${conformsTo}`)
      const result = check(template as Element, instance as Element)
      if (!result.ok) throw new Error(`${path} does not conform to ${conformsTo}: ${result.errors.join("; ")}`)
    }
  }
}

// What one audit found over one corpus.
export async function violationsFrom(template: string, name: string, documents: Record<string, string>) {
  await assertConforming(documents)
  const check = await auditNamed(template, name)
  return (await check(corpus(documents))).violations
}

// A read-only corpus over a map of path to markup. A path runs from the
// repository root, which is how an AuditFs lists one, so an audit asking for
// `docs` with an `.html` extension sees exactly what the map holds.
export function corpus(documents: Record<string, string>): AuditFs {
  const paths = Object.keys(documents)
  return {
    root: "/corpus",
    list(dir = ".", options = {}) {
      const prefix = !dir || dir === "." ? "" : `${dir}/`
      return paths.filter((path) => path.startsWith(prefix) && (!options.ext || path.endsWith(options.ext)))
    },
    read: (path) => documents[path] ?? "",
    parse: (path) => parseHTML(documents[path] ?? "").document as unknown as Document,
  }
}

// The three builders below write what a real instance carries and nothing
// else. A corpus made of them stays readable inside the case that declares it,
// which is the point of holding one in memory rather than on disk.
export function axiomDoc(title: string, narrows?: string): string {
  const up = narrows ? `\n  <a data-rel="depends_on" href="${narrows}">narrows</a>` : ""
  return `<canon-axiom data-conforms-to="../../templates/canon.template.html#canon-axiom">
  <canon-title>${title}</canon-title>
  <canon-confidence>80</canon-confidence>${up}
</canon-axiom>`
}

export function specificationDoc(
  title: string,
  options: { serves?: string; behaviours?: { id: string; title: string }[] } = {},
): string {
  const up = options.serves ? `\n  <a data-rel="depends_on" href="${options.serves}">serves</a>` : ""
  const claims = (options.behaviours ?? [])
    .map((b) => `\n  <canon-behaviour id="${b.id}">\n    <canon-title>${b.title}</canon-title>\n  </canon-behaviour>`)
    .join("")
  return `<canon-specification data-conforms-to="../../templates/canon.template.html#canon-specification">
  <canon-title>${title}</canon-title>${up}${claims}
</canon-specification>`
}

export function testDoc(id: string, name: string, cites?: string): string {
  const citation = cites ? `\n    <a data-rel="depends_on" href="${cites}">the behaviour this checks</a>` : ""
  return `<test-doc data-conforms-to="../templates/test.template.html#test-doc">
  <test-title>${name}</test-title>
  <test-subject><a href="../templates/canon.template.html">canon.template.html</a></test-subject>
  <test-case id="${id}" data-conforms-to="../templates/test.template.html#test-case">
    <test-name>${name}</test-name>
    <test-status>PENDING</test-status>${citation}
    <script type="text/mycelium-test">assert(true)</script>
  </test-case>
</test-doc>`
}
