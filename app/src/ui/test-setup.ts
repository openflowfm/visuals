// The unit project's setup (`vitest.config.ts`): jest-dom's matchers
// (`toBeInTheDocument`…) on `expect`, and, in a test file that runs in a DOM
// (`// @vitest-environment jsdom` or `happy-dom`), Testing Library's cleanup after
// each test, as zen's own setup did for these tests. Node-only tests load nothing more.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';

afterEach(async () => {
  if (typeof document === 'undefined') return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
