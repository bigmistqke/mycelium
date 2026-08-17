// The contract between the engine and a family's own embedded scripts.
//
// A project writes a command or an audit inside a template document, and the
// engine runs it, handing it these objects. Until this file existed the shapes
// were declared privately in run.ts and validate.ts, so a command could only
// destructure them and hope — every one of the arguments below arrived as an
// implicit any.
//
// Kept separate from run.ts on purpose. An embedded script imports from here
// with `import type`, which erases completely, so nothing in the corpus ends up
// depending on the engine at run time; what it depends on is the contract,
// which is what this file is. See
// .mycelium/specs/2026-08-01-script-type-decides-the-language.spec.html.

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
  // The relative href linking one document to another, both named from the
  // docs root the same way `fs.get` names them. The engine used to compute
  // this from the raw arguments, which only worked while a family kept every
  // file in one directory — see
  // .mycelium/specs/2026-08-07-link-href-from-the-command-base.spec.html.
  href: (from: string, to: string) => string
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
  // True when a path will exist once this run's writes land — a file this run
  // created counts, and one it deleted does not.
  exists(path: string): boolean
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

// A documents tree of a node test's own, thrown away when the case ends. The
// templates of the real repository are linked into it, because a command lives
// inside a template and a tree without them has no command to run.
export interface TestSandbox {
  // Absolute path to the tree. `docs` sits inside it, and every path below is
  // relative to that.
  readonly dir: string
  // Runs the real command line against this tree, in its own process. Slower
  // than calling the exported function, and it covers what calling it would
  // miss: how arguments parse, which path a command picks, how a document
  // serializes, and the exit code that comes back.
  mycelium(...argv: string[]): { ok: boolean; status: number | null; stdout: string; stderr: string }
  read(path: string): string
  exists(path: string): boolean
  write(path: string, text: string): void
}

// Throws when its first argument is false, which is the whole failure protocol
// a test case has. `near` compares two measured numbers with a tolerance.
export interface TestAssert {
  (ok: unknown, text?: string): void
  near(a: number, b: number, tolerance?: number, text?: string): void
}

// What a node test's default export is handed. The browser kind gets its own
// three names in the page instead, from test.element.js, since nothing under
// Node is there to hand it anything.
export interface TestContext {
  assert: TestAssert
  sandbox: TestSandbox
}

// What an audit is handed. Read-only, and rooted one level above the corpus
// directory so src/ is reachable. A rule about language applies to a
// comment in a source file as much as to prose in a document, and an
// audit that can only see HTML can never say so.
export interface AuditFs {
  root: string
  // The corpus directory, relative to that root. Rooting above the corpus is
  // what makes an audit need this: reaching src/ costs it the ability to say
  // "the documents" without naming them, and twelve call sites answered that
  // by repeating a literal. A dot-named corpus turns every one of those into an
  // empty list rather than an error, and an audit checking nothing passes.
  docsDir: string
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

// A tree of documents somebody can run a whole check over. An AuditFs plus the
// one question a check about missing files has to ask.
export interface Corpus extends AuditFs {
  exists(path: string): boolean
}

// Everything validate reaches outside itself, in one object it is handed rather
// than builds.
//
// Until this existed validate was the one command that ignored the filesystem
// the engine gave it and went straight to node:fs, which is why it was also the
// one command no test could contain. A run now takes its corpus and its two
// loaders as arguments, so a case can hand it documents it wrote in memory and
// read the verdict back as a value.
//
// The loaders stay separate from the corpus on purpose. A module loads from a
// real path through the hook in script-hooks.ts, so virtualising a document
// does not virtualise the script inside it. Substituting code is a different
// act from substituting data, and passing a loader makes a case say which one
// it means rather than getting the other by accident.
// Where the documents sit is not here, though it was until an audit needed the
// same fact. It lives on the corpus now, so a run and an audit read one value
// rather than two that agree by convention.
export interface ValidateEnv {
  corpus: Corpus
  loadCheck(file: string, script: Element): Promise<(...args: unknown[]) => unknown>
  loadGenericValidator(): Promise<(templateEl: Element, instanceEl: Element) => { ok: boolean; errors: string[] }>
}

// What a run reports, as a value. check() prints this and sets the exit code
// from it; a case reads it instead, so no test has to parse output or infer a
// verdict from a process.
export interface ValidateReport {
  checked: number
  fail: number
  failures: string[]
}
