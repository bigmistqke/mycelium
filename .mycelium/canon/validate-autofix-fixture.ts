// A two-field type, which is the smallest shape that can be out of order, plus
// an instance carrying an edge and a script so a case can watch those stay put.
//
// Its own validator accepts anything with a title, so the tree stays valid
// whichever order the fields sit in. Order is what the generic schema check
// decides, and this fixture exists to be repaired rather than to fail.

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
    <thing-note></thing-note>
    <a repeatable href=".+" data-rel="^(supports)$"></a>
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

const instance = (fields: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>a thing</title>
</head>
<body>
<thing-doc data-conforms-to="./thing.template.html#thing">
${fields}
</thing-doc>
</body>
</html>
`

const IN_ORDER = `  <thing-title>a thing with a title</thing-title>
  <thing-note>and a note under it</thing-note>
  <a data-rel="supports" href="./two.thing.html">a peer</a>
  <script type="mycelium/example">
    const kept = 1
  </script>`

// The note climbs above the title, which is the one thing autofix repairs. The
// edge and the script sit where they sat, so a case can tell a field moving
// from everything else moving with it.
const SHUFFLED = `  <thing-note>and a note under it</thing-note>
  <thing-title>a thing with a title</thing-title>
  <a data-rel="supports" href="./two.thing.html">a peer</a>
  <script type="mycelium/example">
    const kept = 1
  </script>`

export function orderedTree(options: { shuffled: boolean }): Record<string, string> {
  return {
    "tidy/thing.template.html": TEMPLATE,
    "tidy/one.thing.html": instance(options.shuffled ? SHUFFLED : IN_ORDER),
    "tidy/two.thing.html": instance(IN_ORDER.replace("./two.thing.html", "./one.thing.html")),
  }
}
