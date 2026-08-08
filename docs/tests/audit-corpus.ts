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
import { loadCheck, loadGenericValidator, loadModule, parseHTML, resolveTemplateRef } from "../../src/utils.ts"
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

// The builders below write what a real document carries and nothing else. A
// canon document holds one subsystem's axioms and the specification its
// behaviours belong to, so a fixture made of them reads like the corpus does.
export function canonDoc(options: {
  axioms?: { id: string; title: string; narrows?: string }[]
  specification?: { id: string; title: string; behaviours?: { id: string; title: string; refines?: string }[] }
}): string {
  const conforms = (type: string) => `data-conforms-to="../templates/canon.template.html#canon-${type}"`
  const axioms = (options.axioms ?? []).map((axiom) => {
    const up = axiom.narrows ? `\n  <a data-rel="depends_on" href="${axiom.narrows}">narrows</a>` : ""
    return `<canon-axiom id="${axiom.id}" ${conforms("axiom")}>
  <canon-title>${axiom.title}</canon-title>
  <canon-confidence>80</canon-confidence>${up}
</canon-axiom>`
  })
  const specification = options.specification
    ? [`<canon-specification id="${options.specification.id}" ${conforms("specification")}>
  <canon-title>${options.specification.title}</canon-title>${(options.specification.behaviours ?? []).map((b) => {
    const up = b.refines ? `\n    <a data-rel="depends_on" href="${b.refines}">the principle this refines</a>` : ""
    return `\n  <canon-behaviour id="${b.id}" ${conforms("behaviour")}>
    <canon-title>${b.title}</canon-title>${up}
  </canon-behaviour>`
  }).join("")}
</canon-specification>`]
    : []
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Canon</title>
</head>
<body>
${[...axioms, ...specification].join("\n\n")}
</body>
</html>
`
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

// A corpus that reads through to the real repository unless the case provided
// the path, and a way to run the whole of validate against one.
//
// This is what makes a check about the command itself containable. Nothing
// touches disk, nothing spawns, and the verdict comes back as a value. A case
// states only the documents it cares about; the templates, the commands and
// everything else arrive from the real tree, so a fixture stays a few lines
// rather than a copy of the corpus.
import { existsSync } from "node:fs"
import type { Corpus, ValidateEnv, ValidateReport } from "../../src/api.ts"
import { walkFiles } from "../../src/utils.ts"

const REPO = resolve(DOCS, "..")

export function overlay(materials: Record<string, string>): Corpus {
  const provided = Object.keys(materials)
  const has = (path: string) => Object.hasOwn(materials, path)
  return {
    root: REPO,
    list(dir = ".", options = {}) {
      const prefix = !dir || dir === "." ? "" : `${dir}/`
      const real = existsSync(resolve(REPO, dir))
        ? walkFiles(resolve(REPO, dir)).map((file) => file.slice(REPO.length + 1))
        : []
      // A provided path wins over the real one it shadows, and a provided path
      // with no real counterpart still lists, which is how a case adds a
      // document to a tree it did not write.
      return [...new Set([...real, ...provided])]
        .filter((path) => path.startsWith(prefix) && (!options.ext || path.endsWith(options.ext)))
        .sort()
    },
    read: (path) => (has(path) ? materials[path] : readFileSync(resolve(REPO, path), "utf8")),
    exists: (path) => has(path) || existsSync(resolve(REPO, path)),
    parse(path) {
      return parseHTML(this.read(path)).document as unknown as Document
    },
  }
}

// One whole validate run over provided materials.
//
// `checks` substitutes an audit's function by the address of the script
// declaring it, which is how a case gets an audit that reports exactly what the
// case wants to test the comparison against. Substituting code is deliberate
// and separate from substituting documents: a script inside a document the case
// wrote has no real file for the module hook to load, so without this it could
// not run at all.
export async function runValidateOn(
  materials: Record<string, string>,
  options: { docsDir?: string; checks?: Record<string, (fs: Corpus) => unknown> } = {},
): Promise<ValidateReport> {
  const command = resolve(DOCS, "commands/validate.command.html")
  const script = parseHTML(readFileSync(command, "utf8")).document.querySelector('script[type="mycelium/command"]')
  const { runValidate } = (await loadModule(command, script)) as {
    runValidate: (env: ValidateEnv) => Promise<ValidateReport>
  }
  const corpus = overlay(materials)
  const env: ValidateEnv = {
    corpus,
    docsDir: options.docsDir ?? "docs",
    async loadCheck(file, script) {
      const name = script.getAttribute("data-audits") ?? script.getAttribute("data-validates")
      const provided = options.checks?.[`${file}#${name}`]
      if (provided) return provided as (...args: unknown[]) => unknown
      return loadCheck(resolve(REPO, file), script)
    },
    // Always the real one. The generic validator is code, and code stays real
    // unless a case deliberately provides it, so a tree pointed at by --dir
    // still gets checked by the validator this repository actually ships.
    loadGenericValidator: () => loadGenericValidator(resolve(REPO, "docs")),
  }
  return runValidate(env)
}

// A document declaring one audit, for a case testing what validate does with
// what an audit reports. The script is a placeholder: the run substitutes the
// function through `checks`, so what matters here is the tag carrying the name
// and the expectations.
export function auditDoc(name: string, ...expects: string[]): string {
  const declared = expects.length ? ` data-expects="${expects.join(" ")}"` : ""
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Audit: ${name}</title>
</head>
<body>
<script type="mycelium/audit" data-audits="${name}"${declared}>
  export default function () {
    return { ok: true, violations: [] }
  }
</script>
</body>
</html>
`
}

// A document declaring one type, so a case can build a small tree that answers
// to a template of its own rather than to this repository's.
export function typeDoc(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Template: ${name}</title>
</head>
<body>
<template id="${name}">
  <${name}-doc>
    <${name}-title required></${name}-title>
  </${name}-doc>
</template>
</body>
</html>
`
}

export function typeInstance(name: string, title: string, template: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
</head>
<body>
<${name}-doc data-conforms-to="${template}#${name}">
  <${name}-title>${title}</${name}-title>
</${name}-doc>
</body>
</html>
`
}
