import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@/generated/prisma/client";
import { setupTestDb } from "../helpers/testDb";
import {
  HEALTH_CACHE_MS,
  cachedHealth,
  checkHealth,
  probeDatabase,
  resetHealthCacheForTests,
} from "@/lib/health";
import { isPublicPath } from "@/lib/auth.config";
import { GET } from "@/app/api/health/route";

// GET /api/health (#477): a public check that the server can read its
// database, for managed hosts (PikaPods, Render) and uptime monitors.

const db = setupTestDb();

afterEach(() => {
  resetHealthCacheForTests();
  vi.restoreAllMocks();
});

describe("checkHealth", () => {
  it("reports ok when the database answers", async () => {
    await expect(checkHealth(async () => 1)).resolves.toEqual({
      httpStatus: 200,
      body: { status: "ok" },
    });
  });

  it("reports unavailable, without the error text, when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await checkHealth(async () => {
      throw new Error("SQLITE_CANTOPEN: /app/data/app.db");
    });
    expect(result).toEqual({ httpStatus: 503, body: { status: "unavailable" } });
    expect(JSON.stringify(result)).not.toContain("SQLITE");
  });
});

describe("probeDatabase against real SQLite files", () => {
  it("passes on the migrated test database", async () => {
    await expect(checkHealth(() => probeDatabase(db.prisma))).resolves.toMatchObject({ httpStatus: 200 });
  });

  it("fails on a file that isn't a SQLite database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dir = mkdtempSync(path.join(os.tmpdir(), "hearth-health-"));
    const file = path.join(dir, "garbage.db");
    writeFileSync(file, "this is not a sqlite database, just some bytes ".repeat(200));
    const client = new PrismaClient({ adapter: new PrismaLibSql({ url: `file:${file}` }) });
    try {
      await expect(checkHealth(() => probeDatabase(client))).resolves.toEqual({
        httpStatus: 503,
        body: { status: "unavailable" },
      });
    } finally {
      await client.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("cachedHealth", () => {
  it("reuses one probe result for HEALTH_CACHE_MS, then probes again", async () => {
    const probe = vi.fn(async () => 1);
    await cachedHealth(probe, 1_000);
    await cachedHealth(probe, 1_000 + HEALTH_CACHE_MS - 1);
    expect(probe).toHaveBeenCalledTimes(1);
    await cachedHealth(probe, 1_000 + HEALTH_CACHE_MS);
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("/api/health route", () => {
  it("is reachable without a session", () => {
    expect(isPublicPath("/api/health")).toBe(true);
  });

  it("answers 200 ok against a real database, uncached", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
