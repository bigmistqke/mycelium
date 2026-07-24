import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve as resolvePath } from "node:path"
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

// A data: URL dynamic import — the one trick that lets a script's source
// text (pulled straight from a <script> tag, not a real file) run as a
// real ES module with no server and no real cross-file import, which
// would otherwise be CORS-checked with no stable origin to satisfy it
// over file://. Used identically for a type's validator, a graph-wide
// audit, and a template's own authoring commands. The one browser call
// site (knowledge.template.html's audits live-demo) duplicates these same
// five lines directly rather than importing this file — see
// docs/specs/2026-07-24-mycelium-remove-runtime-js.spec.html.
export async function loadModule(scriptSource: string): Promise<Record<string, unknown>> {
  return await import(`data:text/javascript,${encodeURIComponent(scriptSource)}`)
}

export async function loadCheck(scriptSource: string): Promise<(...args: unknown[]) => unknown> {
  const mod = await loadModule(scriptSource)
  return mod.check as (...args: unknown[]) => unknown
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
    const scriptSource = (document as unknown as Document)
      .querySelector(`script[data-validates="#${fragId}"]`)
      ?.textContent

    if (!scriptSource) return { ok: false, errors: [`no template found at ${key}`] }

    const check = await loadCheck(scriptSource)
    const result = check(element) as { ok: boolean; errors?: string[]; violations?: string[] }
    return { ok: result.ok, errors: (result.errors ?? result.violations ?? []) as string[] }
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
