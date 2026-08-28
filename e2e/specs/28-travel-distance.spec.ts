import { test, expect } from "@playwright/test";
import { ADMIN_AUTH_FILE } from "../env";

test.use({ storageState: ADMIN_AUTH_FILE });

// #13: distance is only ever computed via a live AviationStack lookup
// (src/lib/integrations/flightDistance.ts), which needs a real BYOK API key
// — not available in this environment, and not something CI should depend
// on. Like this suite's existing OCR exclusion, the network-dependent
// lookup path itself isn't covered by e2e; haversineKm/buildDistanceSummary
// have full unit coverage (tests/unit/flight-distance.test.ts), and the
// rendered result was verified manually against a scratch DB with a
// directly-seeded distanceKm value. This test covers what IS reachable
// through the UI alone: the summary card correctly stays hidden when no
// segment has a computed distance yet.
test("the distance summary card doesn't show when no flight segment has a computed distance", async ({
  page,
}) => {
  const stamp = Date.now();

  await page.goto("/travel/new");
  await page.locator("#title").fill(`Distance Regression Trip ${stamp}`);
  await Promise.all([
    page.waitForURL(/\/travel\/(?!new$)[^/]+$/),
    page.getByRole("button", { name: "Add trip" }).click(),
  ]);
  const tripId = page.url().split("/travel/")[1];

  // A flight segment with no departure/arrival IATA never gets a distance
  // (computeSegmentDistance requires both), so the card should stay hidden.
  await page.goto(`/travel/${tripId}/segments/new`);
  await page.locator("#type").selectOption("FLIGHT");
  await page.locator("#title").fill("Regression Flight (no route)");
  await page.getByRole("button", { name: "Add segment" }).click();
  await page.waitForURL(/\/travel\/[^/]+$/);

  await page.goto("/travel");
  await expect(page.getByText("Distance travelled")).toHaveCount(0);
});
