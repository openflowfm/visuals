import { defineConfig } from 'vitest/config';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';

// Two projects. `unit` is the editor page's unit tests, next to what they test in
// app/src, under node (`npm test`). Named rather than left to vitest's default,
// which would also walk teaser/ and any worktree under .claude/. `stories`
// renders every story (`app/src/*.stories.tsx`) in headless Chromium and fails
// if one throws or its play function fails (`npm run test:stories`); the addon
// reads `.storybook/` for the stories and the preview.
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'unit', include: ['app/src/**/*.test.{ts,tsx}'], environment: 'node' },
      },
      {
        plugins: [storybookTest({ configDir: '.storybook' })],
        test: {
          name: 'stories',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      // A failing run is when the report is most worth having.
      reportOnFailure: true,
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      // Spelled out rather than inferred from what the tests imported: a file
      // nobody imports should read 0% rather than go missing.
      include: ['app/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.stories.tsx', 'app/src/stories/**', '**/*.d.ts'],
    },
  },
});
