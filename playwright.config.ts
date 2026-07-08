import { defineConfig, devices } from "@playwright/test";
import {
  BASE_URL,
  PORT,
  DATABASE_URL,
  UPLOADS_DIR,
  AUTH_SECRET,
} from "./e2e/env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH },
  },
  webServer: {
    command: "npx next dev",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL,
      UPLOADS_DIR,
      AUTH_SECRET,
      APP_URL: BASE_URL,
      PORT: String(PORT),
    },
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
});
