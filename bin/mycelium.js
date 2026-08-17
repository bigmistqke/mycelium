#!/usr/bin/env node
// What `mycelium` runs, in this repository and in any project installing it.
//
// Plain JavaScript, and the only such file the package ships. Node decides
// whether to strip types from a file by its extension, so a .ts bin would work
// here and fail wherever a launcher copies the file rather than linking it.
// One .js line costs nothing and removes the question.
//
// Importing run.ts is the whole of it. Node 24 strips types on import, so this
// reaches the same source the repository runs — there is no build step, and no
// compiled second copy that could fall behind it.
import "../src/run.ts"
