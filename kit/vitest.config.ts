import { defineConfig } from 'vitest/config';

// The kit renderer's own tests: reading a Sketch document and turning its
// layers into the scene the browser draws. Separate from the root config,
// which covers only the app's page.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
