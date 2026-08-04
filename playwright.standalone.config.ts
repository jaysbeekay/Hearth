import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/standalone",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH },
  },
  projects: [
    {
      name: "standalone-mobile-shell",
      use: {
        ...devices["Pixel 5"],
      },
    },
  ],
});
