import { defineConfig } from 'vitest/config';

// One project per module, so a run can be read — or taken — a module at a
// time: `npm test -- --project=client`, and a named group in the report
// rather than every file in one list.
const module = (name: string, include: string[], exclude?: string[]) => ({
  test: { name, include, exclude, environment: 'node' as const },
});

// Three projects: the renderer, the server, and the modules both are built
// on. The third is what is left rather than a list, so a test in a directory
// nobody has thought of yet still runs — vitest's own exclude defaults go
// with it, since naming one replaces them all.
const SHARED = ['client/**', 'server/**', '**/node_modules/**', '**/dist/**'];

export default defineConfig({
  test: {
    projects: [
      module('visuals', ['**/*.test.ts'], SHARED),
      module('visuals/client', ['client/**/*.test.ts']),
      module('visuals/server', ['server/**/*.test.ts']),
    ],
    // Vitest 5's HTML reporter takes a directory rather than outputFile.
    // Keep report/ as the complete publishable site, including coverage.
    reporters: ['default', ['html', { outputDir: 'report' }]],
    coverage: {
      provider: 'v8',
      // Off by default, which means a failing run writes no report at all —
      // and a failing run is when the report is most worth having.
      reportOnFailure: true,
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      // Spelled out rather than inferred from what the tests imported: a file
      // nobody imports is the interesting case, and it should read 0% rather
      // than go missing.
      include: ['client/**/*.{ts,tsx}', 'server/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
    },
  },
});
