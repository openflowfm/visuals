import { defineConfig } from 'vitest/config';

// The bench's own tests: the metrics that score a pair and the HLSL repairs
// that let Butterchurn draw a preset. Separate from the root config, which
// covers only the editor page.
export default defineConfig({
  test: {
    include: ['harness/**/*.test.ts'],
    environment: 'node',
  },
});
