# Spike result — PASS-A

The gate's top risk (spec risk #1): does coverage attribute to hive's SOURCE lines,
or only to its compiled `dist/` output? If only to dist, every line-based reach target
is meaningless.

**Answer: PASS-A. Coverage attributes to source.**

Ran the C4 probe (a bug known to be real) against hive@5d52a98 under v8 coverage:

- The probe **failed** with `expected '95' not to be '95'` — C4 confirmed real, as expected.
- Coverage landed on `packages/core/src/lib/event-store.ts` — **source**, 348/729 statements.
- No Plan-B alias needed.

## One load-bearing config detail

`vitest.gate.config.ts` must set `coverage.reportOnFailure: true`. Without it, v8 collects
NO coverage when a test fails — and a CONFIRMED verdict is exactly a probe that FAILS while
reaching its code. Omit this flag and every real bug reports as UNREACHABLE. The config in
this directory has it.
