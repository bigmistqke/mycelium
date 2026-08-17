// What the comments command needs around it before it can judge anything: a
// guide to judge against, and a `claude` to ask.
//
// The command shells out to `claude -p`, so a case that lets the real one answer
// would be slow and would decide differently between runs. A stub on PATH is the
// seam, and it needs no change to the command: the sandbox spawns the real
// command line as a child process, and a child inherits the environment.

import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const GUIDE = "language/guides/comment-earns-its-place.guide.html"

// One sentinel per field the command reads out of the guide, so a case can ask
// which of them reached the model rather than trusting that they all did.
export const FIELDS = {
  title: "SENTINEL-TITLE a comment earns its place",
  detail: "SENTINEL-DETAIL the four things that earn the space",
  pass: "SENTINEL-PASS // the format another tool demands",
  fail: "SENTINEL-FAIL // adds one to the counter",
}

export function guideDoc(): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Guide</title></head>
<body>
<language-guide data-conforms-to="../../templates/language.template.html#language-guide">
  <language-title>${FIELDS.title}</language-title>
  <language-pass>${FIELDS.pass}</language-pass>
  <language-fail>${FIELDS.fail}</language-fail>
  <language-detail><p>${FIELDS.detail}</p></language-detail>
</language-guide>
</body></html>
`
}

// A comment carrying one of these decides its own verdict, so a case can lay out
// exactly the mix of verdicts it wants to see handled.
export const CUT = "CUTME"
export const PROMOTE = "PROMOTEME"

const DECIDER = `const { readFileSync } = require("node:fs")
const text = readFileSync(process.argv[2], "utf8")
const out = {}
for (const m of text.matchAll(/### comment (\\d+)\\n"""\\n([\\s\\S]*?)\\n"""/g)) {
  const verdict = m[2].includes("${CUT}") ? "cut" : m[2].includes("${PROMOTE}") ? "promote" : "keep"
  out[m[1]] = { verdict, reason: "the stub said " + verdict }
}
process.stdout.write(JSON.stringify(out))
`

/**
 * Put a stub `claude` on PATH, and take it off again.
 *
 * In "decide" mode it answers from the markers in each comment, and keeps the
 * prompt it was handed so a case can read what the command actually asked.
 *
 * In "refuse" mode it fails loudly. That is how a case proves a verdict never
 * reached a model: if the command asks anything at all, the run goes red.
 */
export function stubClaude(mode: "decide" | "refuse" = "decide") {
  const dir = mkdtempSync(join(tmpdir(), "mycelium-claude-"))
  const promptFile = join(dir, "prompt.txt")
  const script =
    mode === "refuse"
      ? `#!/bin/sh\ncat > "${promptFile}"\necho "the stub was asked, and this case says nothing should have asked it" >&2\nexit 3\n`
      : `#!/bin/sh\ncat > "${promptFile}"\ncat "${promptFile}" >> "${join(dir, "calls.txt")}"\necho >> "${join(dir, "calls.txt")}"\nexec node "${join(dir, "decide.cjs")}" "${promptFile}"\n`

  writeFileSync(join(dir, "decide.cjs"), DECIDER)
  writeFileSync(join(dir, "claude"), script)
  chmodSync(join(dir, "claude"), 0o755)

  const before = process.env.PATH
  process.env.PATH = `${dir}:${before}`
  return {
    promptFile,
    callLog: join(dir, "calls.txt"),
    restore() {
      process.env.PATH = before
    },
  }
}
