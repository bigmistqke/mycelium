import { defineConfig } from 'vitest/config';

const probe = process.env.GATE_PROBE;
const covDir = process.env.GATE_COV;
if (!probe || !covDir) throw new Error('GATE_PROBE and GATE_COV must be set');

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [probe],
    testTimeout: 30000,
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['json'],
      reportsDirectory: covDir,
      include: ['**/packages/core/**'],
      exclude: ['!**/dist/**'],
      all: false,
      clean: true,
      reportOnFailure: true,
      allowExternal: true,
    },
  },
});
