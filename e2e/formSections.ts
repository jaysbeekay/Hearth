import type { Page } from "@playwright/test";

/**
 * #361 — record forms fold optional fields into "More details" and
 * "Reminders" sections. Opens every closed one, for a test that fills them.
 */
export async function openFormSections(page: Page) {
  const closed = page.locator("details[data-form-section]:not([open]) > summary");
  // Each click opens one, so the list shrinks: always take the first.
  while ((await closed.count()) > 0) {
    await closed.first().click();
  }
}
