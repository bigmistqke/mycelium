// The contract between the engine and a family's own embedded scripts.
//
// A project writes a command or an audit inside a template document, and the
// engine runs it, handing it these objects. Until this file existed the shapes
// were declared privately in run.ts and validate.ts, so a command could only
// destructure them and hope — every one of the arguments below arrived as an
// implicit any.
//
// Kept separate from run.ts on purpose. An embedded script imports from here
// with `import type`, which erases completely, so nothing in docs/ ends up
// depending on the engine at run time; what it depends on is the contract,
// which is what this file is. See
// docs/specs/2026-08-01-script-type-decides-the-language.spec.html.

// Every flag becomes a key. Positional arguments collect in `_`, so
// `knowledge add goal --title x` gives { _: ["goal"], title: "x" }.
export interface ParsedArgs {
  _: string[]
  [key: string]: string | string[]
}

// Validates one element against the type its data-conforms-to names. Never
// throws: an unresolvable reference is a reported failure.
export type Validate = (root: Element, instancePath: string) => Promise<{ ok: boolean; errors: string[] }>

export interface Cli {
  validate: Validate
  // Reads standard input to the end. What `--detail -` and its siblings use.
  readStdin: () => Promise<string>
  parseHTML: (html: string) => { document: Document }
}

// The write side. A command mutates the documents it is handed, in place, and
// returns nothing; the engine serializes and writes everything touched once
// the command has finished.
export interface CommandFilesystem {
  // Absolute path every other path here is relative to.
  readonly root: string
  get(path: string): Document
  create(path: string, seedHtml: string): Document
  delete(path: string): void
  list(dir: string): { path: string; doc: Document }[]
  // Writes everything touched so far. The engine calls this once after a
  // command returns, so a command does not normally call it — plan check does,
  // deliberately, to flush the steps that passed before it throws for the ones
  // that did not.
  commit(): string[]
}

export interface CommandContext {
  fs: CommandFilesystem
  args: ParsedArgs
  cli: Cli
}

// What an audit is handed. Read-only, and rooted one level above the docs
// directory so src/ is reachable. A rule about language applies to a
// comment in a source file as much as to prose in a document, and an
// audit that can only see HTML can never say so.
export interface AuditFs {
  root: string
  list(dir?: string, options?: { ext?: string }): string[]
  read(path: string): string
  parse(path: string): Document
}

// What an audit returns. `violations` names what it found, and each audit
// declares the ones it expects in data-expects, so a deliberate violation in
// a template's own worked example is an assertion rather than a failure.
export interface AuditResult {
  ok: boolean
  violations: string[]
}
