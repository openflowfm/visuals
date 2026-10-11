import { defineConfig } from 'vitest/config';

// The tagging tool's own tests: the vocabulary, label storage, grid picking,
// the scorers and calibration, the rubric's batch requests and the report.
// Separate from the root config, which covers only the app's page.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
