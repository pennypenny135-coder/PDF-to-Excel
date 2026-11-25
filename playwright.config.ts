import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    acceptDownloads: true,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "e2e", testIgnore: /ocr\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // 需要下載 OCR 語言模型（網路），請以 npm run test:ocr 單獨執行
    { name: "ocr", testMatch: /ocr\.spec\.ts/, timeout: 300_000, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT} -H 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
