// #481 — DISABLE_INTERNAL_SCHEDULER switches the in-process ticker off and
// leaves the job processor running.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb } from "../helpers/testDb";

const { schedule } = vi.hoisted(() => ({ schedule: vi.fn() }));
vi.mock("node-cron", () => ({ default: { schedule }, schedule }));

import { register } from "@/instrumentation";

setupTestDb();

const EVERY_MINUTE = "* * * * *";
const EVERY_20_SECONDS = "*/20 * * * * *";
const scheduled = () => schedule.mock.calls.map(([pattern]) => pattern);

beforeEach(() => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.spyOn(console, "log").mockImplementation(() => {});
  const g = globalThis as { __jobTickerStarted?: boolean; __jobProcessorStarted?: boolean };
  delete g.__jobTickerStarted;
  delete g.__jobProcessorStarted;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  schedule.mockClear();
});

describe("register (scheduled jobs)", () => {
  it("starts the ticker and the job processor by default", async () => {
    await register();
    expect(scheduled()).toEqual([EVERY_MINUTE, EVERY_20_SECONDS]);
  });

  it("leaves the ticker off but keeps the job processor when DISABLE_INTERNAL_SCHEDULER is true", async () => {
    vi.stubEnv("DISABLE_INTERNAL_SCHEDULER", "true");
    await register();
    expect(scheduled()).toEqual([EVERY_20_SECONDS]);
  });

  it("only a value of true turns it off", async () => {
    vi.stubEnv("DISABLE_INTERNAL_SCHEDULER", "false");
    await register();
    expect(scheduled()).toEqual([EVERY_MINUTE, EVERY_20_SECONDS]);
  });
});
