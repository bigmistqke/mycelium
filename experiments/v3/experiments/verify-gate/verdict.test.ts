import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkReach, decide } from './verdict.ts';
import type { CoverageMap, ReachTarget } from './verdict.ts';

const EVENT_STORE = 'packages/core/src/lib/event-store.ts';
const target = (lines: number[]): ReachTarget => ({ file: EVENT_STORE, lines });
/** cov(executed, statements): statements defaults to executed (all declared lines coverable). */
const cov = (executed: number[], statements: number[] = executed): CoverageMap =>
  new Map([[EVENT_STORE, { executed: new Set(executed), statements: new Set(statements) }]]);

describe('checkReach — the probe must run every statement-line it declared', () => {
  test('satisfied when every declared statement-line executed', () => {
    const [c] = checkReach([target([100, 101])], cov([100, 101]));
    assert.equal(c.satisfied, true);
    assert.deepEqual(c.hit, [100, 101]);
    assert.deepEqual(c.missed, []);
  });

  test('NOT satisfied when a declared statement-line did not execute — THE C1 LESSON', () => {
    // The probe named the claim's dead path (677) alongside a live line (100). Only the
    // live line ran. "At least one" would call this REFUTED; the honest verdict is that
    // the claim's own code never executed.
    const [c] = checkReach([target([100, 677])], cov([100], [100, 677]));
    assert.equal(c.satisfied, false);
    assert.deepEqual(c.hit, [100]);
    assert.deepEqual(c.missed, [677]);
  });

  test('ignores declared non-statement lines (braces, blanks, bad numbers)', () => {
    // 999 is not a statement; it must neither help nor hurt.
    const [c] = checkReach([target([100, 999])], cov([100], [100]));
    assert.equal(c.satisfied, true);
    assert.deepEqual(c.hit, [100]);
    assert.deepEqual(c.missed, []);
  });

  test('not satisfied when none of the declared statement-lines executed', () => {
    const [c] = checkReach([target([677, 678])], cov([], [677, 678]));
    assert.equal(c.satisfied, false);
  });

  test('not satisfied when the file never loaded', () => {
    const [c] = checkReach([target([100])], new Map());
    assert.equal(c.satisfied, false);
  });

  test('not satisfied when the probe declared no coverable statement line at all', () => {
    const [c] = checkReach([target([999])], cov([100], [100]));
    assert.equal(c.satisfied, false);
  });

  test('requires EVERY target satisfied, not just one', () => {
    const cs = checkReach([target([100]), target([677])], cov([100], [100, 677]));
    assert.deepEqual(cs.map(c => c.satisfied), [true, false]);
  });
});

describe('decide — the four verdicts', () => {
  const reached = checkReach([target([100])], cov([100]));
  const notReached = checkReach([target([677])], cov([], [677]));

  test('CONFIRMED: failed on assertion AND reached', () => {
    assert.equal(
      decide({ kind: 'assertion-failed', message: "AssertionError: expected '95' not to be '95'" }, reached).verdict,
      'CONFIRMED',
    );
  });
  test('REFUTED: passed AND reached', () => {
    assert.equal(decide({ kind: 'passed' }, reached).verdict, 'REFUTED');
  });
  test('UNREACHABLE: passed but executed none of the named code — THE BUG THIS GATE EXISTS FOR', () => {
    // Two of three hand probes did exactly this last session; pass/fail called them REFUTED.
    assert.equal(decide({ kind: 'passed' }, notReached).verdict, 'UNREACHABLE');
  });
  test('UNREACHABLE: failed but reached nothing is not a confirmation', () => {
    assert.equal(decide({ kind: 'assertion-failed', message: 'AssertionError: nope' }, notReached).verdict, 'UNREACHABLE');
  });
  test('INVALID: errored — the gate failed, not the claim', () => {
    assert.equal(decide({ kind: 'errored', message: 'TypeError: x is not a function' }, reached).verdict, 'INVALID');
  });
  test('INVALID beats reach: an errored probe is never a finding', () => {
    assert.equal(decide({ kind: 'errored', message: 'boom' }, reached).verdict, 'INVALID');
    assert.equal(decide({ kind: 'errored', message: 'boom' }, notReached).verdict, 'INVALID');
  });
  test('reason names the missed lines', () => {
    const { reason } = decide({ kind: 'passed' }, notReached);
    assert.match(reason, /677/);
    assert.match(reason, /event-store\.ts/);
  });
});
