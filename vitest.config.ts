import { defineConfig } from 'vitest/config';

// The editor page's unit tests, next to what they test in app/src. Named rather
// than left to vitest's default, which would also walk teaser/ and any worktree
// under .claude/.
export default defineConfig({
  test: {
    include: ['app/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // A failing run is when the report is most worth having.
      reportOnFailure: true,
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // Spelled out rather than inferred from what the tests imported: a file
      // nobody imports should read 0% rather than go missing.
      include: ['app/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
    },
  },
});
