// One subsystem small enough to read: an axiom, a specification naming a source
// file, one behaviour, and a source file whose doc comment cites it.
//
// The point is the last rung. Everything above it is the smallest thing that
// lets a citation in code have somewhere to land.

const CANON = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Canon: sample</title></head>
<body>
<canon-axiom id="a-principle" data-conforms-to="../templates/canon.template.html#canon-axiom">
  <canon-title>A principle the sample behaviour narrows.</canon-title>
  <canon-detail><p>Reasoning, because an axiom carries one.</p></canon-detail>
</canon-axiom>
<canon-specification id="a-subsystem" data-conforms-to="../templates/canon.template.html#canon-specification">
  <canon-title>a sample subsystem</canon-title>
  <a data-rel="specifies" href="../sample/widen.ts">the file it answers for</a>
  <canon-behaviour id="a-claim" data-conforms-to="../templates/canon.template.html#canon-behaviour">
    <canon-title>A cut takes the line it sat on.</canon-title>
    <a data-rel="depends_on" href="./sample.canon.html#a-principle">the axiom it refines</a>
  </canon-behaviour>
</canon-specification>
</body></html>
`

const SOURCE = `/**
 * Widens a cut to the whole line, so the blank line it sat on goes with it.
 *
 * @behaviour canon/sample.canon.html#a-claim
 */
function widen(source, at) {
  const lineStart = source.lastIndexOf("\\n", at - 1) + 1
  return source.slice(lineStart, at).trim() ? at : lineStart
}
`

export function tinySubsystem(): Record<string, string> {
  return { "canon/sample.canon.html": CANON, "sample/widen.ts": SOURCE }
}

// Generates the page and hands back the data it embeds, which is what every
// claim about the drawing is really a claim about.
export function chainOf(sandbox: any, assert: (ok: unknown, text?: string) => void) {
  const done = sandbox.mycelium("canon", "generate", "chain", "--out", "chain.html")
  assert(done.ok, `generate failed: ${(done.stderr || done.stdout).trim()}`)
  const page = sandbox.read("chain.html")
  const open = page.indexOf(">", page.indexOf('id="chain"')) + 1
  return JSON.parse(page.slice(open, page.indexOf("</script>", open)))
}
