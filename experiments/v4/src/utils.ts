import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"
import { Window } from "happy-dom"

export function parseHTML(html: string): { document: Document } {
  const window = new Window()
  window.document.write(html)
  return { document: window.document as unknown as Document }
}

export function walkHtmlFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) results.push(...walkHtmlFiles(full))
    else if (entry.endsWith(".html")) results.push(full)
  }
  return results
}

// Given an instance's own file and its data-conforms-to value (a path
// relative to that file, plus a #fragment naming the type), resolves to
// "<absolute template file path>#<fragment>" — the same key both the
// validator lookup below and validate.ts's whole-corpus discovery use to
// find a type's <template>/<script data-validates> pair.
export function resolveTemplateRef(instanceFile: string, conformsTo: string): string {
  const [relPath, fragId] = conformsTo.split("#")
  const templateFile = resolvePath(dirname(instanceFile), relPath)
  return `${templateFile}#${fragId}`
}

// Identifies a script within its own document for script-hooks.ts's
// resolve()/load() to re-find later: its own id if it declared one
// (making it importable from elsewhere, per
// docs/knowledge/2026-07-25-id-based-cross-script-imports.decision.html),
// otherwise a positional token computed identically here and in load() —
// derived from the file, never persisted or assigned randomly.
function locatorFor(script: Element): string {
  const id = script.getAttribute("id")
  if (id) return id
  const scripts = Array.from(script.ownerDocument!.querySelectorAll("script"))
  return `@${scripts.indexOf(script)}`
}

// Runs a template-embedded <script> as a real ES module, addressed by its
// real file and its locator within that file (see locatorFor above) —
// script-hooks.ts's resolve()/load() hooks (registered once by run.ts and
// validate.ts) turn "<file>#<locator>" into a synthetic file: URL sitting
// beside the real file, then re-extract that exact script's text as the
// module's source. Real file: URL, real hierarchical base, so the
// script's own relative imports (a shared helper, another family's
// validator via the same #locator form) resolve normally — unlike the
// data: URL this replaced, which had no base to resolve anything against.
// See docs/specs/2026-07-25-virtual-module-script-imports.spec.html.
export async function loadModule(filePath: string, script: Element): Promise<Record<string, unknown>> {
  const locator = encodeURIComponent(locatorFor(script))
  const fileUrl = pathToFileURL(filePath).href
  return await import(`${fileUrl}#${locator}`)
}

export async function loadCheck(filePath: string, script: Element): Promise<(...args: unknown[]) => unknown> {
  const mod = await loadModule(filePath, script)
  return mod.check as (...args: unknown[]) => unknown
}

// Imports the one generic validator shared by every type that doesn't
// declare its own data-validates script (see template.template.html).
// A plain dynamic import, resolved by the same script-hooks.ts hook
// loadCheck's own loadModule relies on -- both run.ts and validate.ts
// already call register() before either of them ever reaches this
// function, so the hook is always active by the time it's called.
export async function loadGenericValidator(
  docsDir: string,
): Promise<(templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }> {
  const templateTemplateFile = resolvePath(docsDir, "templates/template.template.html")
  const mod = await import(`${pathToFileURL(templateTemplateFile).href}#validate-from-template`)
  return mod.validateFromTemplate as (templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }
}

// Validates one element against its own declared type, for callers (like
// run.ts's authoring commands) that only ever need to check a single node
// they just built or mutated — not validate.ts's whole-corpus batch pass.
// Reads the referenced template file fresh on every call and never throws:
// an unresolvable reference is a reported failure, not an exception, the
// same way validate.ts already treats it.
export async function validateInstance(
  docsDir: string,
  instancePath: string,
  element: Element,
): Promise<{ ok: boolean; errors: string[] }> {
  const conformsTo = element.getAttribute("data-conforms-to")
  if (!conformsTo) return { ok: false, errors: ["missing data-conforms-to attribute"] }

  const instanceFile = resolvePath(docsDir, instancePath)
  const key = resolveTemplateRef(instanceFile, conformsTo)
  const [templateFile, fragId] = key.split("#")

  try {
    const { document } = parseHTML(readFileSync(templateFile, "utf8"))
    const doc = document as unknown as Document
    const templateEl = doc.querySelector(`template#${fragId}`)
    if (!templateEl) return { ok: false, errors: [`no template found at ${key}`] }

    let generic: { ok: boolean; errors: string[] } | null = null
    try {
      const genericCheck = await loadGenericValidator(docsDir)
      generic = genericCheck(templateEl as unknown as Element, element)
    } catch {
      // No template.template.html in this docs tree -- fall back to
      // requiring the type's own data-validates script, same as before
      // this feature existed.
    }

    const script = doc.querySelector(`script[data-validates="#${fragId}"]`)
    if (!script) {
      if (generic) return generic
      return { ok: false, errors: [`no generic validator available and no data-validates script for ${key}`] }
    }

    const check = await loadCheck(templateFile, script)
    const custom = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    const customErrors = (custom.errors ?? custom.violations ?? []) as string[]
    if (!generic) return { ok: custom.ok, errors: customErrors }
    return { ok: generic.ok && custom.ok, errors: [...generic.errors, ...customErrors] }
  } catch (err) {
    return { ok: false, errors: [`validation setup failed — ${(err as Error).message}`] }
  }
}

// Drains stdin fully and returns it as a string. The only new shared
// primitive this project needs for rich-content authoring — what a
// command's own `-` sentinel means (if anything) is domain knowledge
// that stays in the command, not here.
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}
