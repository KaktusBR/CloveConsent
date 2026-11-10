import { defineConfig, devices } from '@playwright/test'

const port = 4317
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './global-setup.ts',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: { command: 'node fixtures/serve.mjs', url: `http://localhost:${port}/health`, env: { PORT: String(port) }, reuseExistingServer: false },
  use: { baseURL: `http://localhost:${port}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
