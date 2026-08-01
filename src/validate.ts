// The mycelium v4 crawler. Protocol-only: it knows about <template>,
// data-conforms-to, data-validates, and data-audits — nothing about what
// any project builds on top of them. See docs/specs/2026-07-23-mycelium-crawler.spec.html.

import { existsSync, readFileSync } from "node:fs"
import { styleText } from "node:util"
import { dirname, resolve as resolvePath } from "node:path"
import { register } from "node:module"
import { parseHTML, walkFiles, walkHtmlFiles, resolveTemplateRef, loadCheck, loadGenericValidator } from "./utils.ts"

register("./script-hooks.ts", import.meta.url)

interface ParsedDoc {
  path: string
  dom: Document
}

interface TemplateInfo {
  id: string
  file: string
  element: Element
  validatorScript: Element | null
}

interface AuditInfo {
  name: string
  touches: string | null
  // The violations this audit is supposed to find: the ids of instances that
  // exist precisely so it has something to catch. A template builds its
  // worked example to fail the audit it illustrates, and declaring that here
  // is what lets the audit run over the whole corpus rather than having
  // documentation hidden from it. Absent means "find nothing", which covers every audit
  // with no fixture.
  expects: string[]
  file: string
  scriptElement: Element
}

interface CheckResult {
  ok: boolean
  [key: string]: unknown
}

// What an audit is handed. Read-only, and rooted one level above the docs
// directory so src/ is reachable. A rule about language applies to a
// comment in a source file as much as to prose in a document, and an
// audit that can only see HTML can never say so.
//
// Handing over a filesystem rather than a list of parsed documents is the
// whole point. Parsed documents are the engine deciding what a project's
// content is, which is not the engine's business; conformance is defined in
// HTML, so the engine parses HTML for that, and stops there. What an audit
// examines is its own affair. It could always have imported node:fs and read
// whatever it liked — this makes the intended path the convenient one instead
// of the awkward one.
export interface AuditFs {
  root: string
  list(dir?: string, options?: { ext?: string }): string[]
  read(path: string): string
  parse(path: string): Document
}

function createAuditFs(root: string, cache: Map<string, Document>): AuditFs {
  return {
    root,
    list(dir = ".", options = {}) {
      // A directory that does not exist holds no files, which is an answer
      // rather than an error. An audit asking about a family that has no
      // entries yet should get an empty list, not a thrown call.
      const full = resolvePath(root, dir)
      if (!existsSync(full)) return []
      return walkFiles(full)
        .filter((file) => !options.ext || file.endsWith(options.ext))
        .map((file) => relative(root, file))
    },
    read(path) {
      return readFileSync(resolvePath(root, path), "utf8")
    },
    // Shares the cache with the parse the instance pass already did, so an
    // audit reading every document costs nothing extra, and three audits
    // reading every document cost nothing extra three times.
    parse(path) {
      const full = resolvePath(root, path)
      let doc = cache.get(full)
      if (!doc) {
        const { document } = parseHTML(readFileSync(full, "utf8"))
        doc = document as unknown as Document
        cache.set(full, doc)
      }
      return doc
    },
  }
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
      templates.set(`${path}#${id}`, { id, file: path, element: tpl, validatorScript: null })
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
        expects: (script.getAttribute("data-expects") ?? "").trim().split(/\s+/).filter(Boolean),
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
  const parseCache = new Map(documents.map((d) => [d.path, d.dom]))
  const auditFs = createAuditFs(dirname(dir), parseCache)
  const { templates, audits } = discoverTemplatesAndAudits(documents)
  const instances = discoverInstances(documents)
  // Audits see every document, templates included. A template builds its
  // worked examples to fail the audit they illustrate, and each audit
  // declares those in data-expects, so a deliberate violation is an
  // assertion rather than a failure.
  //
  // Filtering templates/ out instead would name a location to mean "fixture",
  // and it costs more than the imprecision: an audit declared in one template
  // file could then never see anything declared in another.
  let genericCheck: ((templateEl: Element, instanceEl: Element) => CheckResult) | null = null
  try {
    genericCheck = await loadGenericValidator(dir)
  } catch {
    // No template.template.html in this docs tree (e.g. a corpus that
    // predates the generic validator) -- fall back to requiring every
    // type to carry its own data-validates script, the same as before
    // this feature existed, instead of crashing the whole run.
  }

  let checked = 0
  let fail = 0
  const failures: string[] = []

  for (const instance of instances) {
    checked++
    const key = resolveTemplateRef(instance.file, instance.conformsTo)
    const template = templates.get(key)
    const label = `${relative(dir, instance.file)}  (${instance.conformsTo})`

    if (!template) {
      fail++
      failures.push(`FAIL  ${label}\n      no template found at ${key}`)
      continue
    }

    try {
      const generic = genericCheck?.(template.element, instance.element) ?? null
      const results: CheckResult[] = []
      if (generic) results.push(generic)
      if (template.validatorScript) {
        const customCheck = await loadCheck(template.file, template.validatorScript)
        const custom = customCheck(instance.element) as CheckResult
        results.push({ ok: custom.ok, errors: (custom.errors ?? custom.violations ?? []) as string[] })
      }
      if (results.length === 0) {
        fail++
        failures.push(`FAIL  ${label}\n      no generic validator available and no data-validates script`)
        continue
      }
      const result: CheckResult = { ok: results.every((r) => r.ok), errors: results.flatMap((r) => r.errors) }
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
      const result = (await check(auditFs)) as CheckResult
      // The comparison is the verdict, so an audit's own `ok` is not
      // consulted: it reports what it found and the engine decides whether
      // that is acceptable. The two ways to be wrong are worth telling
      // apart. A violation nobody declared is the audit doing its job. A
      // declared one that failed to appear means the example built to
      // demonstrate this audit has stopped demonstrating anything.
      const found = (result.violations ?? result.errors ?? []) as string[]
      const unexpected = found.filter((v) => !audit.expects.includes(v))
      const missing = audit.expects.filter((e) => !found.includes(e))
      if (unexpected.length > 0 || missing.length > 0) {
        fail++
        const lines = [
          ...unexpected.map((v) => `      ${v}`),
          ...missing.map((e) => `      declared in data-expects but not found: ${e}`),
        ]
        failures.push(`FAIL  ${label}\n${lines.join("\n")}`)
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

  // exitCode rather than exit() so the output above still flushes.
  if (fail > 0) process.exitCode = 1
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
