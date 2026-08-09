// A documents tree small enough to reason about, for the two cases that have
// to run the real command line in its own process.
//
// It carries its own validator rather than leaning on the generic one, so
// nothing outside the tree has to exist for it to be checkable. That is what
// makes `--dir` point at something self-contained: a run over it reads this and
// nothing else, so a failure in the output came from here.

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Template: thing</title>
</head>
<body>
<template id="thing">
  <thing-doc>
    <thing-title required></thing-title>
  </thing-doc>
</template>
<script type="mycelium/validate" data-validates="#thing">
  export default function (root) {
    const title = root.querySelector('thing-title')
    return title && title.textContent.trim()
      ? { ok: true, errors: [] }
      : { ok: false, errors: ['a thing needs a title'] }
  }
</script>
</body>
</html>
`

const instance = (title: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title || "untitled"}</title>
</head>
<body>
<thing-doc data-conforms-to="./thing.template.html#thing">
  ${title ? `<thing-title>${title}</thing-title>` : ""}
</thing-doc>
</body>
</html>
`

export function tidyTree(options: { withBroken: boolean }): Record<string, string> {
  const tree: Record<string, string> = {
    "tidy/thing.template.html": TEMPLATE,
    "tidy/good.thing.html": instance("a thing with a title"),
  }
  // The broken one omits the title its own validator insists on, so the failure
  // comes from the tree rather than from anything this repository ships.
  if (options.withBroken) tree["tidy/bad.thing.html"] = instance("")
  return tree
}
