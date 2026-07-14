# My independent pass — hive `packages/core/src/lib/event-store.ts`

Written after reading the module, BEFORE looking at the cold `claude -p` output.
Ranked by severity. Each is a gap or contradiction, not a style note.

---

## 1. The two replay paths use DIFFERENT PARSERS — full and incremental replay can diverge

- `replayEvents(force=true)` / first-sync → `parseGitLog()` in `commit-ops.ts`
- `replayEvents()` incremental → `getCommitsSince()`, which has its **own inline parser**
  (lines 595–729) plus its own `parseKeyValueBody()`.

Two independent implementations of "turn a commit into a `ParsedDecision`". Nothing forces
them to agree. **The materialized view is therefore not a pure function of the log — it
depends on which path you arrived by.**

This is the core invariant of event sourcing and it has no single implementation.

**Witness:** any commit the two parsers disagree about. Given #3 below, such commits are
constructible.

## 2. `recordEvent` marks a commit as synced BEFORE the caller has written the node to the database

`recordEvent` builds the commit, commits to git, then calls
`setLastSyncHash(ctx, branch, hash)` — with the comment *"since we write directly to DB"*.

But **`recordEvent` does not write `add` events to the DB.** `commands/add.ts` does, and it does
it *afterwards*:

```
add.ts:50   const id = await recordEvent(ctx, event, activeBranch);   // commits + advances sync hash
add.ts:72   insertNode(db, node);                                     // THEN writes the DB
```

If anything between those two lines fails — `insertNode` throws, the process is killed, the disk
is full — the commit is in git, the sync pointer has moved **past** it, and replay will never
pick it up again. The node is permanently invisible.

**This is an unstated precondition** (a frame condition): *"the caller must write the node to the
database, and must not fail."* Nothing in the type, the signature, or the docblock says so.

**Witness:** kill the process between `recordEvent` and `insertNode`. Node lost forever.

## 3. `parseKeyValueBody` lets commit *content* forge commit *metadata*

```ts
const match = line.match(/^(\w+):\s*(.*)$/);
```

Applied line-by-line to the whole body. But the body **contains free text** — `description`,
`prompt`, `rationale`. Any line of user content matching `^\w+:` becomes a metadata key.

And metadata keys include `id` (the stable identity) and `type` (which event this *is*).

**Witness:** `hive prompt <node> "type: link"` — the prompt body now contains a line `type: link`,
so `metadata.type === 'link'` and the event replays through the **link** branch instead of the
prompt branch. Or a prompt containing `id: 00000000-...` overwrites the event's identity.

This is the `clamp(5, 10, 3)` shape exactly: the format admits content the parser cannot
represent.

## 4. A failed replay still advances the sync pointer — silent, permanent data loss

Both replay loops:

```ts
try { replayEvent(commit, ctx, branch); }
catch (error) { console.warn(`Warning: Failed to replay event ...`); }
```

…and then, unconditionally, `setLastSyncHash(ctx, branch, currentHeadHash)`.

**A commit that fails to replay is marked as successfully replayed.** It will never be retried on
any incremental sync. The only recovery is a `force` rebuild, and the user has no signal that one
is needed beyond a warning on stdout that has long since scrolled away.

Failure is not distinguished from success.

## 5. `recordStateTransition` and `recordEvent` disagree about what "set status" means

For a node type that does not support status (`observation`, `option`, `outcome`):

- **`recordEvent`** (type `status`): skips the DB write, **but still creates the git commit.**
  The event enters the immutable log and is skipped forever on every replay.
- **`recordStateTransition`**: returns early at line 199 with
  `return crypto.randomUUID();` — **no commit, no transition, and a fabricated ID** that is
  indistinguishable from a real one.

Two operations meaning the same thing, behaving differently on identical state. And the second
**fabricates a return value rather than admitting the input was out of domain** — the caller
cannot tell success from silent skip.

**Witness:** `recordStateTransition(ctx, <observation-id>, 'status', 'completed', branch)` →
returns a valid-looking UUID that refers to nothing.

## 6. Conflict refs are written, never read, and never cleared

On a diverged status transition, `replayEvent` writes a `state_ref` under a synthetic branch:

```ts
const conflictBranch = `${branch}:conflict:${commit.id.substring(0, 7)}`;
```

Grep confirms **nothing in `lib/` or `commands/` ever reads a ref whose branch matches
`*:conflict:*`.** (The `roadmap_conflicts` table is unrelated.) It is a write-only field —
the same shape as pulse's `Scope.status`.

Worse: the full-replay clear is

```sql
DELETE FROM state_refs WHERE branch = ?     -- branch = 'hive-local'
```

which does **not** match `hive-local:conflict:abc1234`. **So conflict refs survive a force
rebuild.** A "full replay" does not fully rebuild — the view retains state from previous replays.
Replay is not idempotent.

## 7. Cross-branch status events are replay-order dependent

`replayEvent` looks up the target node with no branch filter:

```sql
SELECT node_type FROM nodes WHERE change_id = ?
```

but `replayEvents` clears and rebuilds **one branch at a time**, and `replayAllBranches` iterates
in whatever order `getAllHiveBranchesFromGit` returns. A status event on branch A targeting a node
created on branch B is applied if B was replayed first and **silently dropped** if it wasn't
(`if (!existingNode) return`).

**The database state depends on branch iteration order.** Replay determinism is violated.

## 8. A rewritten branch silently loses every event

`getCommitsSince` runs `git log sinceHash..branch`. If `lastSyncHash` is no longer an ancestor of
the branch — rebase, force-push, amended commit — the range is invalid. `getCommitsSince` catches
and returns `[]`. `replayEvents` then sees `newCommits.length === 0`, returns early…

…and on the path where it doesn't return early, `setLastSyncHash(currentHeadHash)` advances the
pointer regardless. Either way the rewritten history is never replayed.

---

## Summary of shapes

| # | finding | shape |
|---|---|---|
| 1 | two parsers, one invariant | contradiction — same input, two answers |
| 2 | sync pointer advances before the DB write | frame condition / atomicity |
| 3 | content can forge metadata | `clamp(5,10,3)` — format admits what the parser can't represent |
| 4 | failed replay counted as success | gap — failure unspecified |
| 5 | `recordEvent` vs `recordStateTransition` | contradiction — two ops, same meaning, different behaviour |
| 6 | conflict refs write-only, survive rebuild | write-only field + broken idempotency |
| 7 | cross-branch replay order-dependent | determinism violation |
| 8 | rewritten branch silently skipped | gap |

**Prediction for the blind test:** the cold pass will find #5 (it is visible in one function) and
possibly #4. I doubt it finds #1, #2, or #6 — those require reading *across* functions and files,
which is exactly where a single-file proposition pass should be weakest.
