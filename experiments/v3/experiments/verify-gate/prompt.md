You are writing ONE falsification probe for ONE claim about hive's event store.

The claim was produced by a model reading `packages/core/src/lib/event-store.ts`. It
asserts the module's behaviour is either UNSPECIFIED (a gap) or SPECIFIED TWICE AND
INCOMPATIBLY (a contradiction). Find out whether it is true.

## The claim
KIND: {{KIND}}
WITNESS: {{WITNESS}}
WHY IT MATTERS: {{WHY}}

## The module's contract, as the same model described it
{{PROPOSITIONS}}

## The module source (line-numbered — use these exact numbers in `reaches`)
```ts
{{SOURCE}}
```

## Your job
Write a SINGLE vitest test that **FAILS if the claim is TRUE**. You are falsifying it:
assert the behaviour that SHOULD hold. If the claim is real your assertion will not hold
and the test fails — that failure is the finding. Do NOT assert the buggy behaviour and
pass; that inverts the polarity and makes the bug look like the spec.

## Rules
- ONE `describe`, ONE `it`. No extra assertions.
- The failure must come from `expect()`, not a throw. A probe that dies in setup proves
  nothing and is discarded.
- Import only from `vitest`, `isomorphic-git`, and `@hive/core`.
- Use these bootstrap helpers VERBATIM. Do not invent your own fixture.

```ts
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
  await git.commit({ fs: ctx.fs as any, dir, message: 'Initial commit',
    author: { name: 'Test User', email: 'test@example.com' } });
  await git.branch({ fs: ctx.fs as any, dir, ref: branch });
  return { ctx, dir };
}
async function addNode(ctx: HiveContext, title: string): Promise<string> {
  const id = await recordEvent(ctx, { type: 'add', nodeType: 'decision', content: title, confidence: 90 }, branch);
  const db = getDatabase(ctx);
  const now = new Date().toISOString();
  const node: Node = { change_id: id, branch, node_type: 'decision', title, status: 'pending', created_at: now, updated_at: now };
  insertNode(db, node);
  return id;
}
```

## Declare what you will execute
Name the lines of `packages/core/src/lib/event-store.ts` your probe will cause to run —
where the claimed behaviour lives. This is checked against real coverage. **If none of the
lines you name execute, your probe is discarded**, whatever it did. Name the lines the
claim is about, and make sure your probe runs them.

## Output — JSON ONLY. No prose. No code fence.
{
  "probe": "<the complete .test.ts file, as a string>",
  "reaches": [ { "file": "packages/core/src/lib/event-store.ts", "lines": [120, 121, 122] } ]
}
