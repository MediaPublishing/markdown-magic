import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.ts',
  timeout: 45_000,
  retries: 0,
  reporter: [['line']],
  use: {
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
});
