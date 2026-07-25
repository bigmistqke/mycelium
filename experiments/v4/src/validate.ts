// The mycelium v4 crawler. Protocol-only: it knows about <template>,
// data-conforms-to, data-validates, and data-audits — nothing about what
// any project builds on top of them. See docs/specs/2026-07-23-mycelium-crawler.spec.html.

import { readFileSync } from "node:fs"
import { styleText } from "node:util"
import { resolve as resolvePath, sep } from "node:path"
import { register } from "node:module"
import { parseHTML, walkHtmlFiles, resolveTemplateRef, loadCheck } from "./utils.ts"

register("./script-hooks.ts", import.meta.url)

interface ParsedDoc {
  path: string
  dom: Document
}

interface TemplateInfo {
  id: string
  file: string
  validatorScript: Element | null
}

interface AuditInfo {
  name: string
  touches: string | null
  file: string
  scriptElement: Element
}

interface CheckResult {
  ok: boolean
  [key: string]: unknown
}

function parseAll(dir: string): ParsedDoc[] {
  return walkHtmlFiles(dir).map((path) => {
    const html = readFileSync(path, "utf8")
    const { document } = parseHTML(html)
    return { path: resolvePath(path), dom: document as unknown as Document }
  })
}

function discoverTemplatesAndAudits(documents: ParsedDoc[]) {
  const templates = new Map<string, TemplateInfo>()
  const audits: AuditInfo[] = []

  for (const { path, dom } of documents) {
    for (const tpl of Array.from(dom.querySelectorAll("template[id]"))) {
      const id = tpl.getAttribute("id")!
      templates.set(`${path}#${id}`, { id, file: path, validatorScript: null })
    }
    for (const script of Array.from(dom.querySelectorAll("script[data-validates]"))) {
      const ref = script.getAttribute("data-validates")!.replace(/^#/, "")
      const info = templates.get(`${path}#${ref}`)
      if (info) info.validatorScript = script
    }
    for (const script of Array.from(dom.querySelectorAll("script[data-audits]"))) {
      audits.push({
        name: script.getAttribute("data-audits")!,
        touches: script.getAttribute("data-touches"),
        file: path,
        scriptElement: script,
      })
    }
  }

  return { templates, audits }
}

interface Instance {
  file: string
  element: Element
  conformsTo: string
}

function discoverInstances(documents: ParsedDoc[]): Instance[] {
  const instances: Instance[] = []
  for (const { path, dom } of documents) {
    for (const el of Array.from(dom.querySelectorAll("[data-conforms-to]"))) {
      instances.push({ file: path, element: el, conformsTo: el.getAttribute("data-conforms-to")! })
    }
  }
  return instances
}

async function main() {
  const dir = resolvePath(process.argv[2] ?? "./docs")
  const documents = parseAll(dir)
  const { templates, audits } = discoverTemplatesAndAudits(documents)
  const instances = discoverInstances(documents)
  // Audits answer whole-graph questions ("is every outcome linked to?"); the
  // template's own live-demo sample instances aren't real graph data, just a
  // documentation fixture, so they'd corrupt that answer if left in. Per-
  // instance validation (below) is unaffected — it validates one element in
  // isolation, so a sample instance in the mix is harmless there.
  const templatesDir = resolvePath(dir, "templates") + sep
  const auditDocuments = documents.filter((d) => !d.path.startsWith(templatesDir))

  let checked = 0
  let fail = 0
  const failures: string[] = []

  for (const instance of instances) {
    checked++
    const key = resolveTemplateRef(instance.file, instance.conformsTo)
    const template = templates.get(key)
    const label = `${relative(dir, instance.file)}  (${instance.conformsTo})`

    if (!template || !template.validatorScript) {
      fail++
      failures.push(`FAIL  ${label}\n      no template found at ${key}`)
      continue
    }

    try {
      const check = await loadCheck(template.file, template.validatorScript)
      const result = check(instance.element) as CheckResult
      if (!result.ok) {
        fail++
        failures.push(`FAIL  ${label}\n${formatItems(result)}`)
      }
    } catch (err) {
      fail++
      failures.push(`FAIL  ${label}\n      validator threw — ${(err as Error).message}`)
    }
  }

  for (const audit of audits) {
    checked++
    const label = `${audit.name}  (${relative(dir, audit.file)}${audit.touches ? `, touches: ${audit.touches}` : ""})`
    try {
      const check = await loadCheck(audit.file, audit.scriptElement)
      const result = (await check(auditDocuments)) as CheckResult
      if (!result.ok) {
        fail++
        failures.push(`FAIL  ${label}\n${formatItems(result)}`)
      }
    } catch (err) {
      fail++
      failures.push(`FAIL  ${label}\n      audit threw — ${(err as Error).message}`)
    }
  }

  console.log(styleText(fail === 0 ? "green" : "red", `${checked} checked, ${fail} fail`))
  for (const f of failures) {
    console.log("")
    console.log(styleText("red", f))
  }
}

function relative(from: string, to: string): string {
  return to.startsWith(from) ? to.slice(from.length + 1) : to
}

function formatItems(result: CheckResult): string {
  const items = (result.errors ?? result.violations) as string[] | undefined
  if (!items || items.length === 0) return `      ${JSON.stringify(result)}`
  return items.map((item) => `      ${item}`).join("\n")
}

main()
