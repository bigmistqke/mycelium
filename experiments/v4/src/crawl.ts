// The mycelium v4 crawler. Protocol-only: it knows about <template>,
// data-conforms-to, data-validates, and data-audits — nothing about what
// any project builds on top of them. See docs/specs/2026-07-23-mycelium-crawler.spec.html.

import { readdirSync, statSync, readFileSync } from "node:fs"
import { join, dirname, resolve as resolvePath } from "node:path"
import { parseHTML } from "linkedom"
import "./runtime.js"

const { loadCheck } = globalThis.mycelium

interface ParsedDoc {
  path: string
  dom: Document
}

interface TemplateInfo {
  id: string
  file: string
  validatorScript: string | null
}

interface AuditInfo {
  name: string
  touches: string | null
  file: string
  scriptSource: string
}

interface CheckResult {
  ok: boolean
  [key: string]: unknown
}

function walkHtmlFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) results.push(...walkHtmlFiles(full))
    else if (entry.endsWith(".html")) results.push(full)
  }
  return results
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
      if (info) info.validatorScript = script.textContent
    }
    for (const script of Array.from(dom.querySelectorAll("script[data-audits]"))) {
      audits.push({
        name: script.getAttribute("data-audits")!,
        touches: script.getAttribute("data-touches"),
        file: path,
        scriptSource: script.textContent ?? "",
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

function resolveTemplateRef(instanceFile: string, conformsTo: string): string {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

async function main() {
  const dir = resolvePath(process.argv[2] ?? "./docs")
  const documents = parseAll(dir)
  const { templates, audits } = discoverTemplatesAndAudits(documents)
  const instances = discoverInstances(documents)

  console.log(`${documents.length} documents, ${templates.size} templates, ${instances.length} instances, ${audits.length} audits\n`)

  let pass = 0
  let fail = 0
  for (const instance of instances) {
    const key = resolveTemplateRef(instance.file, instance.conformsTo)
    const template = templates.get(key)
    const label = `${relative(dir, instance.file)}  (${instance.conformsTo})`

    if (!template || !template.validatorScript) {
      console.log(`FAIL  ${label}: no template found at ${key}`)
      fail++
      continue
    }

    try {
      const check = await loadCheck(template.validatorScript)
      const result = check(instance.element) as CheckResult
      console.log(`${result.ok ? "PASS " : "FAIL "} ${label}`)
      if (!result.ok) console.log(`      ${JSON.stringify(result)}`)
      result.ok ? pass++ : fail++
    } catch (err) {
      console.log(`FAIL  ${label}: validator threw — ${(err as Error).message}`)
      fail++
    }
  }

  console.log(`\nvalidators: ${pass} pass, ${fail} fail\n`)

  for (const audit of audits) {
    const label = `${audit.name}  (${relative(dir, audit.file)}${audit.touches ? `, touches: ${audit.touches}` : ""})`
    try {
      const check = await loadCheck(audit.scriptSource)
      const result = (await check(documents)) as CheckResult
      console.log(`${result.ok ? "PASS " : "FAIL "} ${label}`)
      console.log(`      ${JSON.stringify(result)}`)
    } catch (err) {
      console.log(`FAIL  ${label}: audit threw — ${(err as Error).message}`)
    }
  }
}

function relative(from: string, to: string): string {
  return to.startsWith(from) ? to.slice(from.length + 1) : to
}

main()
