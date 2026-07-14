# trace — the code↔intent edge

The first shippable piece of v3. No harness, no solver, no schema, no store.
**A commit convention and a hook.**

## The problem it solves

Code retrieval is **self-guiding**: an import says what to read next, a call site points at a
definition, so anyone — human or model — following the structure gets carried along. That is why
a model handed one file will happily go and read four more.

**Intent has no such handle.** Nothing in a repository points from a line of code to the reasoning
that produced it, and *you cannot search for a decision you do not know exists*. So the reasoning
gets reconstructed from the source, every session, forever — the inverse problem `VISION.md` opens
by condemning.

## The insight

**Git already keeps a map from every line to the commit that wrote it.** So the commit message is
where the edge belongs.

```
line of code  →  git blame  →  commit  →  Decision: <uuid>  →  node  →  the reasoning
                 ^^^^^^^^^^
                 already there, already maintained, already understood by the agent
```

This is decision-graph node **#270** — *"introspection like git blame but for intent"* — written in
January. **The metaphor was the implementation.**

## Why the message and not the database

deciduous already records `node → commit` via `--commit HEAD`. That link points the wrong way and
lives in the wrong place.

| | `--commit HEAD` | a commit trailer |
|---|---|---|
| direction | node → commit | **commit → node** — the way retrieval needs to go |
| lives in | deciduous's SQLite | **git history** |
| survives the tool dying | no | **yes** |
| travels with `git push` | no | **yes** |
| reverse lookup | query the database | `git log --grep <uuid>` |

**Cite the `change_id` UUID, never the integer id.** Commit messages are immutable; the integer is
a display alias that would not survive a move to another store, and a hundred commits citing `274`
would become a hundred dangling references. Both deciduous and hive key on the same UUID, so a
trailer written today still resolves after a migration.

## Why the hook verifies instead of trusting

**An agent asked to cite something will cite something.** A hook that only demands a trailer buys
100% coverage and some fraction of it confabulated — which is worse than honest 52%, because it
*looks* complete.

So the hook checks:

1. a `Decision:` trailer is present → else reject
2. the UUID resolves to exactly one node → else reject
3. **if that node declares files, they overlap the files this commit actually changes** → else reject

Step 3 is the point. It cannot prove a citation is *right*, but it makes a false one **expensive to
construct**. Same principle as everything else in this design: *never ask a model to label; make it
back a claim that something else can check.*

And it makes the loop self-hosting: log the action node **before** the work, declaring the files
you are about to touch; commit; the hook checks the files match what you actually changed. **A
prediction made before the evidence exists, and checked after.**

## Use

```sh
./install.sh                                  # symlinks .git/hooks/commit-msg

trace why  packages/v2/src/cli.ts:100         # a line → the decisions behind it
trace code 341                                # a decision → all the code it produced
trace gaps                                    # what fraction of commits are traceable
```

Commit messages carry:

```
Decision: 673b5a07-a907-4e00-9082-c0966bc4df4d
Implements: 99b17ee7-1cbb-4750-9e3b-7e572a059696
```

## Honest state

**Before this: 102 commits, 0 citing a decision. 0% traceable.** Every line of code in the
repository whose purpose is to preserve intent was a dead end — including the compiler.

The rot is not a human failing. `CLAUDE.md` mandates linking commits to the graph **in bold**, and
an agent read that instruction and complied about half the time. Instructions in context decay;
a hook at the point of action does not. That is the whole reason this is a hook and not a
convention.

**Known limits:**

- **Reformatting destroys blame.** Standard problem, standard fix: `.git-blame-ignore-revs`.
- **A commit may cite several decisions**, so a blame can return more than one. That narrows 340
  nodes to 2–3. Good enough.
- **A cited node with no declared files is accepted with a warning.** The citation is real but
  *unverified* — nothing checked that the commit has anything to do with it. Give nodes files
  (`-f`) to make their citations checkable.
- **The file-overlap check is necessary, not sufficient.** It catches a citation aimed at the wrong
  part of the codebase. It cannot catch a plausible citation aimed at the right part for the wrong
  reason.
