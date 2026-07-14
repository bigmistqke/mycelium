/**
 * Probes for the claims produced by a cold proposition pass over event-store.ts.
 * These are FALSIFICATION ATTEMPTS. A failing test here means the claim is real.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import git from 'isomorphic-git';
import {
  recordEvent,
  recordStateTransition,
  replayEvents,
  getDatabase,
  getAllNodes,
  insertNode,
  createTestContext,
  HiveContext,
  Node,
} from '@hive/core';

const branch = 'hive-test';

async function bootstrap(): Promise<{ ctx: HiveContext; dir: string }> {
  const dir = '/test-repo';
  const ctx = await createTestContext(dir);
  ctx.fs.mkdirSync(dir, { recursive: true });
  ctx.fs.mkdirSync(`${dir}/.hive`, { recursive: true });
  await git.init({ fs: ctx.fs as any, dir, defaultBranch: 'main' });
  await git.setConfig({ fs: ctx.fs as any, dir, path: 'user.name', value: 'Test User' });
  await git.setConfig({ fs: ctx.fs as any, dir, path: 'user.email', value: 'test@example.com' });
  ctx.fs.writeFileSync(`${dir}/README.md`, '# Test');
  await git.add({ fs: ctx.fs as any, dir, filepath: 'README.md' });
  await git.commit({
    fs: ctx.fs as any,
    dir,
    message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' },
  });
  await git.branch({ fs: ctx.fs as any, dir, ref: branch });
  return { ctx, dir };
}

/** Mirror what commands/add.ts does: record the event, then write the node through. */
async function addNode(ctx: HiveContext, title: string): Promise<string> {
  const id = await recordEvent(
    ctx,
    { type: 'add', nodeType: 'decision', content: title, confidence: 90 },
    branch,
  );
  const db = getDatabase(ctx);
  const now = new Date().toISOString();
  const node: Node = {
    change_id: id,
    branch,
    node_type: 'decision',
    title,
    status: 'pending',
    created_at: now,
    updated_at: now,
  };
  insertNode(db, node);
  return id;
}

const statusOf = (ctx: HiveContext, id: string) =>
  getAllNodes(getDatabase(ctx)).find(n => n.change_id === id)?.status;

// ---------------------------------------------------------------------------

describe('CLAIM: a status change replays on a cold database but is DROPPED on an incremental sync', () => {
  it('replays the same git log to the same status either way', async () => {
    const { ctx } = await bootstrap();
    const nodeId = await addNode(ctx, 'Use PostgreSQL');
    await replayEvents(ctx, branch, true); // full rebuild -> db is warm and in sync

    // Simulate a teammate's status commit arriving by `git pull`: the commit exists in
    // git, but nothing wrote it to OUR database. This is byte-for-byte the body that
    // recordStateTransition() produces.
    const body = [
      `id: ${crypto.randomUUID()}`,
      `type: state_transition`,
      `node: ${nodeId}`,
      `property: status`,
      `new_value: completed`,
      `parents: []`,
      `branch: ${branch}`,
    ].join('\n');
    await ctx.git.commitToBranch(
      `status: ${nodeId.substring(0, 7)} → completed\n\n${body}`,
      branch,
      { allowEmpty: true },
    );

    // WARM db -> incremental path
    await replayEvents(ctx, branch);
    const incremental = statusOf(ctx, nodeId);

    // COLD db -> full path, SAME git history
    await replayEvents(ctx, branch, true);
    const full = statusOf(ctx, nodeId);

    // The materialized view must be a function of the log, not of how you got there.
    expect({ incremental, full }).toEqual({ incremental: 'completed', full: 'completed' });
  });
});

describe('CLAIM: one `add` against a cold database permanently truncates the view', () => {
  it('replays all pre-existing events after an add on a fresh database', async () => {
    const { ctx } = await bootstrap();

    // A branch that already has history (as after a fresh `git clone`).
    const a = await addNode(ctx, 'decision A');
    const b = await addNode(ctx, 'decision B');
    const c = await addNode(ctx, 'decision C');
    await replayEvents(ctx, branch, true);
    expect(getAllNodes(getDatabase(ctx)).length).toBe(3); // sanity

    // Now simulate a COLD database with that history already in git:
    // wipe the materialized view AND the sync watermark, as a fresh clone would have.
    const db = getDatabase(ctx);
    db.prepare('DELETE FROM nodes').run();
    db.prepare('DELETE FROM sync_state').run();

    // The user's first command is an `add`, not a read.
    const d = await addNode(ctx, 'decision D');

    // Any later read triggers a replay.
    await replayEvents(ctx, branch);

    const titles = getAllNodes(getDatabase(ctx)).map(n => n.title).sort();
    expect(titles).toEqual(['decision A', 'decision B', 'decision C', 'decision D']);
  });
});

describe('CLAIM: a non-status property transition is re-materialized as a STATUS on rebuild', () => {
  it('does not corrupt a node\'s status with an unrelated property value', async () => {
    const { ctx } = await bootstrap();
    const nodeId = await addNode(ctx, 'Use PostgreSQL');
    await replayEvents(ctx, branch, true);

    // Record a transition on a property that is NOT status.
    await recordStateTransition(ctx, nodeId, 'confidence', '95', branch);

    // Rebuild from the log — the operation whose entire job is to reproduce the db.
    await replayEvents(ctx, branch, true);

    expect(statusOf(ctx, nodeId)).not.toBe('95');
  });
});
