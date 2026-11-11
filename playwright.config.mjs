import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list']],
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:4174', channel: 'chrome', serviceWorkers: 'block' },
  webServer: { command: 'node scripts/serve.mjs --port 4174 --strict-port --quiet', url: 'http://127.0.0.1:4174/', reuseExistingServer: true },
});
