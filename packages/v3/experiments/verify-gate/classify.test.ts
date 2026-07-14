import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from './run-probe.ts';
import type { VitestJson } from './run-probe.ts';

const failed = (msg: string): VitestJson => ({
  testResults: [{ assertionResults: [{ status: 'failed', failureMessages: [msg] }] }],
});

describe('classify — assertion failure vs bootstrap throw', () => {
  test('a real expect() failure (vitest strips it to a chai description) is assertion-failed', () => {
    // The exact string vitest's JSON reporter produced for the C4 probe.
    assert.equal(classify(failed("expected '95' not to be '95' // Object.is equality"), '').kind, 'assertion-failed');
  });
  test('an expect().toEqual failure is assertion-failed', () => {
    assert.equal(classify(failed('expected [ 1 ] to deeply equal [ 1, 2 ]'), '').kind, 'assertion-failed');
  });
  test('a thrown TypeError is errored, not a finding', () => {
    assert.equal(classify(failed("TypeError: Cannot read properties of undefined (reading 'nope')"), '').kind, 'errored');
  });
  test('a thrown fs Error is errored', () => {
    assert.equal(classify(failed('Error: ENOENT: no such file or directory'), '').kind, 'errored');
  });
  test('a chai AssertionError thrown by name is still an assertion, not a throw', () => {
    assert.equal(classify(failed('AssertionError: expected true to be false'), '').kind, 'assertion-failed');
  });
  test('a passing test is passed', () => {
    assert.equal(classify({ testResults: [{ assertionResults: [{ status: 'passed' }] }] }, '').kind, 'passed');
  });
  test('no test ran at all (import/syntax error) is errored', () => {
    assert.equal(classify({ testResults: [{ assertionResults: [], message: 'Failed to load url @hive/core' }] }, '').kind, 'errored');
  });
});
