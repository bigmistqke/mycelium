import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkReach, decide } from './verdict.ts';
import type { CoverageMap, ReachTarget } from './verdict.ts';

const EVENT_STORE = 'packages/core/src/lib/event-store.ts';
const target = (lines: number[]): ReachTarget => ({ file: EVENT_STORE, lines });
const covering = (lines: number[]): CoverageMap => new Map([[EVENT_STORE, new Set(lines)]]);

describe('checkReach', () => {
  test('satisfied when at least one declared line executed', () => {
    const [c] = checkReach([target([100, 101, 102])], covering([101]));
    assert.equal(c.satisfied, true);
    assert.deepEqual(c.hit, [101]);
    assert.deepEqual(c.missed, [100, 102]);
  });
  test('not satisfied when none of the declared lines executed', () => {
    const [c] = checkReach([target([677, 678])], covering([100]));
    assert.equal(c.satisfied, false);
    assert.deepEqual(c.hit, []);
  });
  test('not satisfied when the file never loaded', () => {
    const [c] = checkReach([target([100])], new Map());
    assert.equal(c.satisfied, false);
  });
  test('requires EVERY target satisfied, not just one', () => {
    const cs = checkReach([target([100]), target([677])], covering([100]));
    assert.deepEqual(cs.map(c => c.satisfied), [true, false]);
  });
});

describe('decide — the four verdicts', () => {
  const reached = checkReach([target([100])], covering([100]));
  const notReached = checkReach([target([677])], covering([100]));

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
