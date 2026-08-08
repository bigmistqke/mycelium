// What the six chain cases share: reading one audit's findings out of a
// validate run, and writing a test document for the reader to find.
//
// A sandbox holds the real templates and the real commands, so `validate`
// there checks a corpus with no specs, no knowledge nodes and no language
// rules in it. Several audits pass vacuously on that and every-link-resolves
// reports the templates' own links to documents the sandbox does not hold. So
// a case cannot read the exit code, and asks one audit what it found instead.
export function violationsOf(stdout: string, audit: string): string[] {
  const found: string[] = []
  let inside = false
  for (const line of stdout.split("\n")) {
    // Each block opens with `FAIL  <name>  (<where>)` and its findings are the
    // indented lines under it, so the next FAIL ends the one before it.
    const opening = /^FAIL\s+(\S+)/.exec(line)
    if (opening) {
      inside = opening[1] === audit
      continue
    }
    if (inside && line.trim()) found.push(line.trim())
  }
  return found
}

// A test document holding one case, for the cases that need the reader to find
// something rather than the canon commands to write it. There is no authoring
// command for a test, by design: its substance is a fixture and a script, and
// neither fits on a flag.
//
// The script is a browser one so nothing tries to run it. An audit only reads
// these documents, and a sandbox has no browser to open one in.
export function caseDoc(id: string, name: string, cites: string | null): string {
  const citation = cites ? `\n    <a data-rel="depends_on" href="${cites}">the behaviour this checks</a>` : ""
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Test: ${name}</title>
</head>
<body>
<test-doc data-conforms-to="../templates/test.template.html#test-doc">
  <test-title>${name}</test-title>
  <test-subject><a href="../templates/canon.template.html">canon.template.html</a></test-subject>
  <test-case id="${id}" data-conforms-to="../templates/test.template.html#test-case">
    <test-name>${name}</test-name>
    <test-status>PENDING</test-status>${citation}
    <script type="text/mycelium-test">assert(true)</script>
  </test-case>
</test-doc>
</body>
</html>
`
}
