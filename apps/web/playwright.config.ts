import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use a pre-installed Chromium when available (cloud sandboxes), otherwise Playwright's own.
const executablePath =
  process.env.PW_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    launchOptions: executablePath ? { executablePath } : {},
  },
  webServer: [
    {
      command: 'pnpm build && pnpm preview --port 4173 --strictPort',
      url: 'http://localhost:4173/',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // Collaboration server with a throw-away database (the web app connects to it
      // cross-origin, like GitHub Pages + a self-hosted server).
      command: 'pnpm --filter @overleagger/server exec tsx src/main.ts',
      url: 'http://localhost:8788/api/health',
      reuseExistingServer: true,
      timeout: 60_000,
      // Small beta limits, and every @admin.test account is an administrator.
      env: {
        PORT: '8788',
        DB_FILE: ':memory:',
        HOST: '127.0.0.1',
        MAX_PROJECTS: '2',
        ADMIN_EMAILS: '@admin.test',
      },
    },
  ],
});
