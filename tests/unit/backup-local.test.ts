import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const dirs: string[] = [];
const { getLocalConfig } = vi.hoisted(() => ({ getLocalConfig: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getLocalConfig }));

import { pruneLocal, uploadToLocal } from "@/lib/backup/local";

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local backup destination", () => {
  it("writes backup bytes and prunes oldest files to retention", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hearth-backup-"));
    dirs.push(dir);
    getLocalConfig.mockResolvedValue({ path: dir });

    await uploadToLocal(Buffer.from("old"), "old.db.enc");
    await new Promise((resolve) => setTimeout(resolve, 10));
    await uploadToLocal(Buffer.from("new"), "new.db.enc");
    expect(await stat(path.join(dir, "new.db.enc"))).toBeTruthy();

    await pruneLocal(1);
    expect(await readdir(dir)).toEqual(["new.db.enc"]);
  });
});
