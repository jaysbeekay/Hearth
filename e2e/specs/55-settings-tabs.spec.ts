import { test, expect, type Page } from "@playwright/test";
import { ADMIN_AUTH_FILE, MEMBER_AUTH_FILE } from "../env";

// #363 — Settings is two tabs, My account and Household; the old "System
// settings" page is split into Household sections, its old links still
// resolve, schedules read in plain language, and each page has one Save.

test.describe("as an admin", () => {
  test.use({ storageState: ADMIN_AUTH_FILE });

  test("old Settings links land on the new sections", async ({ page }) => {
    await page.goto("/settings/app");
    await expect(page).toHaveURL(/\/settings\/reminders$/);
    await expect(page.getByRole("heading", { level: 1, name: "Reminders & channels" })).toBeVisible();

    await page.goto("/settings/webhooks");
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(page.getByRole("heading", { name: "Webhooks", exact: true })).toBeVisible();

    for (const [href, heading] of [
      ["/settings/users", "Members"],
      ["/settings/modules", "Modules"],
      ["/settings/backups", "Backups"],
      ["/settings/trash", "Recently deleted"],
    ] as const) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    }
  });

  test("the Household tab lists every shared section, and no page says System settings", async ({ page }) => {
    await page.goto("/settings");
    const tabs = page.getByRole("navigation", { name: "Settings" });
    await expect(tabs.getByRole("link", { name: "My account" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "Household" }).click();
    await expect(page).toHaveURL(/\/settings\/household$/);

    const main = page.locator("main");
    for (const section of [
      "Members",
      "Modules",
      "Reminders & channels",
      "AI & privacy",
      "Document ingestion",
      "Integrations",
      "Backups",
      "Recently deleted",
    ]) {
      // Each row's name is its label followed by its status line.
      const row = main.getByRole("link").filter({ has: page.getByText(section, { exact: true }) });
      await expect(row).toBeVisible();
    }
    await expect(main).not.toContainText("System settings");
  });

  test("delivery health comes first on Reminders, and the schedule is a plain-language picker", async ({ page }) => {
    await page.goto("/settings/reminders");
    const headings = page.locator("main h2");
    await expect(headings.first()).toHaveText("Reminder delivery health");
    await expect(page.getByRole("heading", { name: "Reminder delivery health" })).toBeInViewport();

    const form = page.locator("form").filter({ has: page.locator("#reminderCronKind") });
    const hidden = form.locator('input[name="reminderCron"]');
    const original = await hidden.inputValue();

    try {
      await page.locator("#reminderCronKind").selectOption("weekly");
      await page.locator("#reminderCronDay").selectOption("1");
      await page.locator("#reminderCronTime").fill("07:30");
      await expect(hidden).toHaveValue("30 7 * * 1");

      // Advanced starts from what the simple choice stood for.
      await page.locator("#reminderCronKind").selectOption("advanced");
      await expect(page.locator("#reminderCron")).toHaveValue("30 7 * * 1");
      await page.locator("#reminderCron").fill("not a cron");

      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(form).toContainText("isn't a valid cron expression");

      await page.locator("#reminderCron").fill("30 7 * * 1");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(form).toContainText("Reminder schedule saved.");

      // It reads back as the plain-language choice, not as Advanced.
      await page.reload();
      await expect(page.locator("#reminderCronKind")).toHaveValue("weekly");
      await expect(page.locator("#reminderCronDay")).toHaveValue("1");
      await expect(page.locator("#reminderCronTime")).toHaveValue("07:30");

      // And back from Advanced keeps a simple cron's day and time.
      await page.locator("#reminderCronKind").selectOption("advanced");
      await page.locator("#reminderCron").fill("15 6 * * *");
      await page.locator("#reminderCronKind").selectOption("daily");
      await expect(page.locator("#reminderCronTime")).toHaveValue("06:15");
      await expect(hidden).toHaveValue("15 6 * * *");

      // Six fields (with seconds) are refused: the scheduler checks once a minute.
      await page.locator("#reminderCronKind").selectOption("advanced");
      await page.locator("#reminderCron").fill("30 15 6 * * *");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(form).toContainText("Use five fields");
    } finally {
      await page.goto("/settings/reminders");
      if ((await hidden.inputValue()) !== original) {
        await expect(async () => {
          await page.locator("#reminderCronKind").selectOption("advanced");
          await page.locator("#reminderCron").fill(original);
          await expect(page.getByRole("button", { name: "Save changes" })).toBeEnabled({ timeout: 1000 });
        }).toPass({ timeout: 15_000 });
        await page.getByRole("button", { name: "Save changes" }).click();
        await expect(form).toContainText("Reminder schedule saved.");
      }
    }
  });

  test("each page has one Save changes instead of a button per form", async ({ page }) => {
    await page.goto("/settings/reminders");
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toHaveCount(1);
    await expect(save).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Save (email|ntfy|reminder)/ })).toHaveCount(0);
    const originalTopic = await page.locator("#ntfyTopic").inputValue();

    // The group starts listening for edits once the page hydrates; retry the
    // edit until it does, as other specs do for client-only listeners.
    await expect(async () => {
      await page.locator("#ntfyTopic").fill(`e2e-unsaved-topic-${Date.now()}`);
      await expect(save).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();

    // Undoing the edit leaves nothing to save.
    await page.locator("#ntfyTopic").fill(originalTopic);
    await expect(save).toBeDisabled();
    await expect(page.getByText("No unsaved changes.")).toBeVisible();
  });

  test("a section whose save is rejected stays unsaved while the others save", async ({ page }) => {
    await page.goto("/settings/reminders");
    const save = page.getByRole("button", { name: "Save changes" });
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    const ntfyForm = page.locator("form").filter({ has: page.locator("#ntfyTopic") });
    const scheduleForm = page.locator("form").filter({ has: page.locator("#reminderCronKind") });
    const originalTopic = await page.locator("#ntfyTopic").inputValue();
    const originalCron = await scheduleForm.locator('input[name="reminderCron"]').inputValue();
    const topic = `e2e-group-topic-${Date.now()}`;

    try {
      await expect(async () => {
        await page.locator("#ntfyTopic").fill(topic);
        await expect(save).toBeEnabled({ timeout: 1000 });
      }).toPass({ timeout: 15_000 });
      await page.locator("#reminderCronKind").selectOption("advanced");
      await page.locator("#reminderCron").fill("not a cron");
      await expect(bar).toContainText("You have unsaved changes in 2 sections.");

      // ntfy saves; the schedule is rejected and stays unsaved.
      await save.click();
      await expect(ntfyForm).toContainText("Push notification settings saved.");
      await expect(scheduleForm).toContainText("isn't a valid cron expression");
      await expect(bar).toContainText("Some changes weren't saved.");
      await expect(save).toBeEnabled();

      // Retrying the same values sends them again rather than calling them saved.
      const resent = page.waitForRequest((req) => req.method() === "POST" && req.headers()["next-action"] !== undefined);
      await save.click();
      await resent;
      await expect(bar).toContainText("Some changes weren't saved.");
      await expect(save).toBeEnabled();

      await page.locator("#reminderCron").fill(originalCron === "0 9 * * *" ? "0 10 * * *" : "0 9 * * *");
      await save.click();
      await expect(scheduleForm).toContainText("Reminder schedule saved.");
      await expect(bar).toContainText("No unsaved changes.");
      await expect(save).toBeDisabled();

      await page.reload();
      await expect(page.locator("#ntfyTopic")).toHaveValue(topic);
    } finally {
      await page.goto("/settings/reminders");
      if ((await page.locator("#ntfyTopic").inputValue()) !== originalTopic) {
        await expect(async () => {
          await page.locator("#ntfyTopic").fill(originalTopic);
          await expect(save).toBeEnabled({ timeout: 1000 });
        }).toPass({ timeout: 15_000 });
        await save.click();
        await expect(ntfyForm).toContainText("Push notification settings saved.");
      }
      if ((await scheduleForm.locator('input[name="reminderCron"]').inputValue()) !== originalCron) {
        await page.locator("#reminderCronKind").selectOption("advanced");
        await page.locator("#reminderCron").fill(originalCron);
        await save.click();
        await expect(scheduleForm).toContainText("Reminder schedule saved.");
      }
    }
  });
});

// #525 review — the save bar under a dropped connection, a slow save, and
// back/forward navigation. Each restores the ntfy topic it changed.
test.describe("the save bar when saving goes wrong", () => {
  test.use({ storageState: ADMIN_AUTH_FILE });

  const isAction = (req: { method(): string; headers(): Record<string, string> }) =>
    req.method() === "POST" && req.headers()["next-action"] !== undefined;

  async function editTopic(page: Page, value: string) {
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(async () => {
      await page.locator("#ntfyTopic").fill(value);
      await expect(save).toBeEnabled({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
  }

  async function restoreTopic(page: Page, original: string) {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.goto("/settings/reminders");
    if ((await page.locator("#ntfyTopic").inputValue()) === original) return;
    await editTopic(page, original);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Push notification settings saved.").first()).toBeVisible();
  }

  test("a dropped connection keeps the page and the edit, and the save can be retried", async ({ page }) => {
    await page.goto("/settings/reminders");
    const original = await page.locator("#ntfyTopic").inputValue();
    const topic = `e2e-offline-topic-${Date.now()}`;
    const save = page.getByRole("button", { name: "Save changes" });
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    const ntfyForm = page.locator("form").filter({ has: page.locator("#ntfyTopic") });
    try {
      await editTopic(page, topic);
      await page.route("**/settings/reminders", (route) =>
        isAction(route.request()) ? route.abort("internetdisconnected") : route.continue(),
      );
      await save.click();

      // Still the Settings page, with the typed value, a message and Save on.
      await expect(ntfyForm).toContainText("Couldn't reach the server");
      await expect(page.locator("#ntfyTopic")).toHaveValue(topic);
      await expect(bar).toContainText("Some changes weren't saved.");
      await expect(save).toBeEnabled();

      await page.unrouteAll({ behavior: "ignoreErrors" });
      await save.click();
      await expect(ntfyForm).toContainText("Push notification settings saved.");
      await expect(bar).toContainText("No unsaved changes.");
      await page.reload();
      await expect(page.locator("#ntfyTopic")).toHaveValue(topic);
    } finally {
      await restoreTopic(page, original);
    }
  });

  test("a section can't be edited while its save is in flight, so nothing typed is lost", async ({ page }) => {
    await page.goto("/settings/reminders");
    const original = await page.locator("#ntfyTopic").inputValue();
    const topic = `e2e-slow-topic-${Date.now()}`;
    const save = page.getByRole("button", { name: "Save changes" });
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    const ntfyForm = page.locator("form").filter({ has: page.locator("#ntfyTopic") });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await editTopic(page, topic);
      await page.route("**/settings/reminders", async (route) => {
        if (!isAction(route.request())) return route.continue();
        const response = await route.fetch();
        await held;
        await route.fulfill({ response });
      });
      await save.click();

      await expect(bar).toContainText("Saving…");
      await expect(bar.getByRole("button")).toBeDisabled();
      // The section is inert until its action returns.
      await expect(ntfyForm).toHaveJSProperty("inert", true);

      release();
      await expect(ntfyForm).toContainText("Push notification settings saved.");
      await expect(ntfyForm).toHaveJSProperty("inert", false);
      await expect(page.locator("#ntfyTopic")).toHaveValue(topic);
      await expect(bar).toContainText("No unsaved changes.");

      // Editing again afterwards works as normal.
      await page.locator("#ntfyTopic").fill(`${topic}-2`);
      await expect(bar).toContainText("You have unsaved changes.");
    } finally {
      release();
      await restoreTopic(page, original);
    }
  });

  test("back and forward show what's saved, not a stale unsaved state", async ({ page }) => {
    await page.goto("/settings/reminders");
    const original = await page.locator("#ntfyTopic").inputValue();
    const topic = `e2e-history-topic-${Date.now()}`;
    const save = page.getByRole("button", { name: "Save changes" });
    const bar = page.getByRole("region", { name: "Unsaved changes" });
    try {
      await editTopic(page, topic);
      await save.click();
      await expect(page.getByText("Push notification settings saved.").first()).toBeVisible();

      await page.getByRole("link", { name: "Dashboard" }).first().click();
      await page.waitForURL(/\/dashboard/);
      await page.goBack();
      await page.waitForURL(/\/settings\/reminders$/);
      await expect(page.locator("#ntfyTopic")).toHaveValue(topic);
      await expect(bar).toContainText("No unsaved changes.");

      // An unsaved edit left behind doesn't come back as "saved", and the
      // bar agrees with whatever the field shows on return.
      await page.locator("#ntfyTopic").fill(`${topic}-unsaved`);
      await expect(bar).toContainText("You have unsaved changes.");
      await page.goForward();
      await page.waitForURL(/\/dashboard/);
      await page.goBack();
      await page.waitForURL(/\/settings\/reminders$/);
      const shown = await page.locator("#ntfyTopic").inputValue();
      await expect(bar).toContainText(shown === topic ? "No unsaved changes." : "You have unsaved changes.");
      await page.reload();
      await expect(page.locator("#ntfyTopic")).toHaveValue(topic);
    } finally {
      await restoreTopic(page, original);
    }
  });
});

test.describe("as a member", () => {
  test.use({ storageState: MEMBER_AUTH_FILE });

  test("sees the Household tab with the admin-only sections greyed out", async ({ page }) => {
    await page.goto("/settings/household");
    const main = page.locator("main");
    await expect(main).toContainText("Only an admin can change the greyed-out sections.");
    await expect(main.getByRole("link", { name: /^Members/ })).toHaveCount(0);
    for (const section of [
      "Members",
      "Modules",
      "Reminders & channels",
      "AI & privacy",
      "Document ingestion",
      "Integrations",
      "Backups",
      "Security log",
    ]) {
      const row = main.locator('[aria-disabled="true"]').filter({ has: page.getByText(section, { exact: true }) });
      await expect(row).toContainText("Admin only");
      await expect(main.getByRole("link").filter({ has: page.getByText(section, { exact: true }) })).toHaveCount(0);
    }
    await main.getByRole("link", { name: /^Recently deleted/ }).click();
    await expect(page).toHaveURL(/\/settings\/trash$/);
    await expect(main).not.toContainText("System settings");
  });
});
