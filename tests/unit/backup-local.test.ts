import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getLocalConfig } = vi.hoisted(() => ({ getLocalConfig: vi.fn() }));
vi.mock("@/lib/appSettings", () => ({ getLocalConfig }));

import { decryptBuffer, encryptBuffer } from "@/lib/crypto";
import { pruneLocal, uploadToLocal } from "@/lib/backup/local";

const dirs: string[] = [];
process.env.ENCRYPTION_KEY = "F0CiTt+ImWBEgZWCI0tjldALraXIJ5XDLAvTWQqrRmI=";

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

  it("round-trips an encrypted SQLite-like snapshot without plaintext magic", async () => {
    const plaintext = Buffer.concat([Buffer.from("SQLite format 3\0"), Buffer.from("fixture-row")]);
    const encrypted = encryptBuffer(plaintext);
    expect(encrypted.subarray(0, 16).toString()).not.toBe("SQLite format 3\0");
    expect(decryptBuffer(encrypted)).toEqual(plaintext);

    const dir = await mkdtemp(path.join(os.tmpdir(), "hearth-backup-"));
    dirs.push(dir);
    getLocalConfig.mockResolvedValue({ path: dir });
    await uploadToLocal(encrypted, "snapshot.db.enc");
    expect(await stat(path.join(dir, "snapshot.db.enc"))).toBeTruthy();
    expect(await readdir(dir)).toEqual(["snapshot.db.enc"]);
  });
});
