import { describe, it, expect } from 'vitest';
import git from 'isomorphic-git';
import {
  recordEvent, recordStateTransition, replayEvents,
  getDatabase, getAllNodes, insertNode, createTestContext,
  HiveContext, Node,
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
    fs: ctx.fs as any, dir, message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' },
  });
  await git.branch({ fs: ctx.fs as any, dir, ref: branch });
  return { ctx, dir };
}

async function addNode(ctx: HiveContext, title: string): Promise<string> {
  const id = await recordEvent(
    ctx, { type: 'add', nodeType: 'decision', content: title, confidence: 90 }, branch,
  );
  const db = getDatabase(ctx);
  const now = new Date().toISOString();
  const node: Node = {
    change_id: id, branch, node_type: 'decision', title,
    status: 'pending', created_at: now, updated_at: now,
  };
  insertNode(db, node);
  return id;
}

describe('C4', () => {
  it('does not corrupt a node status with an unrelated property value', async () => {
    const { ctx } = await bootstrap();
    const nodeId = await addNode(ctx, 'Use PostgreSQL');
    await replayEvents(ctx, branch, true);
    await recordStateTransition(ctx, nodeId, 'confidence', '95', branch);
    await replayEvents(ctx, branch, true);
    const status = getAllNodes(getDatabase(ctx)).find(n => n.change_id === nodeId)?.status;
    expect(status).not.toBe('95');
  });
});
