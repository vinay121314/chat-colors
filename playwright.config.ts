import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// Keep the test browser inside the project (gitignored) unless the environment says otherwise.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= fileURLToPath(new URL('.pw-browsers', import.meta.url));

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  workers: 1, // each test launches its own browser with the extension
  reporter: 'list',
  use: { screenshot: 'only-on-failure' },
});
