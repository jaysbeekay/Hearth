import { mkdtemp, writeFile, mkdir, rm, utimes, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DocumentStore,
  registerReconcileTarget,
  reconcileDocumentStore,
  __resetReconcileTargetsForTests,
} from "@/lib/documentStore";

const dirs: string[] = [];

afterEach(async () => {
  __resetReconcileTargetsForTests();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setOld(filePath: string) {
  const old = new Date(Date.now() - 60 * 60_000); // 1 hour ago — well past the 10-minute staleness window
  await utimes(filePath, old, old);
}

async function exists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

describe("document store reconciliation (#251)", () => {
  it("removes a stale orphaned file but leaves known and fresh files alone, and reports rows with missing files", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "hearth-docstore-"));
    dirs.push(parentDir);

    const ownerDir = path.join(parentDir, "owner-1");
    await mkdir(ownerDir, { recursive: true });

    await writeFile(path.join(ownerDir, "known.pdf"), "known");
    await writeFile(path.join(ownerDir, "stale-orphan.pdf"), "orphan");
    await setOld(path.join(ownerDir, "stale-orphan.pdf"));
    await writeFile(path.join(ownerDir, "fresh-orphan.pdf"), "fresh");
    // fresh-orphan.pdf keeps its just-written mtime — simulates a request
    // still mid-flight between writing bytes and committing its DB row.

    const fakeRows = [{ ownerId: "owner-1", storedName: "known.pdf" }];
    // "missing.pdf" has a DB row but was never actually written to disk —
    // the direction reconciliation can only report, not repair.
    const rowsWithMissingFile = [{ ownerId: "owner-1", storedName: "missing.pdf" }];

    registerReconcileTarget({
      kind: "testKind",
      store: new DocumentStore((ownerId) => path.join(parentDir, ownerId)),
      parentDir,
      flat: false,
      listOwnerDocuments: async (ownerId) =>
        [...fakeRows, ...rowsWithMissingFile].filter((r) => r.ownerId === ownerId),
    });

    const report = await reconcileDocumentStore();

    expect(await exists(path.join(ownerDir, "known.pdf"))).toBe(true);
    expect(await exists(path.join(ownerDir, "fresh-orphan.pdf"))).toBe(true);
    expect(await exists(path.join(ownerDir, "stale-orphan.pdf"))).toBe(false);

    expect(report.orphanedFilesRemoved).toBe(1);
    expect(report.rowsMissingFiles).toEqual([
      { kind: "testKind", ownerId: "owner-1", storedName: "missing.pdf" },
    ]);
  });

  it("handles a flat (owner-less) target, matching the inbox layout", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "hearth-docstore-flat-"));
    dirs.push(parentDir);

    await writeFile(path.join(parentDir, "known.pdf"), "known");
    await writeFile(path.join(parentDir, "stale-orphan.pdf"), "orphan");
    await setOld(path.join(parentDir, "stale-orphan.pdf"));

    registerReconcileTarget({
      kind: "flatKind",
      store: new DocumentStore(() => parentDir),
      parentDir,
      flat: true,
      listOwnerDocuments: async () => [{ ownerId: "", storedName: "known.pdf" }],
    });

    const report = await reconcileDocumentStore();

    expect(await exists(path.join(parentDir, "known.pdf"))).toBe(true);
    expect(await exists(path.join(parentDir, "stale-orphan.pdf"))).toBe(false);
    expect(report.orphanedFilesRemoved).toBe(1);
  });

  it("does nothing when a target's parent directory doesn't exist yet", async () => {
    const missingDir = path.join(os.tmpdir(), `hearth-docstore-missing-${Date.now()}`);

    registerReconcileTarget({
      kind: "neverUploadedKind",
      store: new DocumentStore((ownerId) => path.join(missingDir, ownerId)),
      parentDir: missingDir,
      flat: false,
      listOwnerDocuments: async () => [],
    });

    await expect(reconcileDocumentStore()).resolves.toEqual({
      orphanedFilesRemoved: 0,
      rowsMissingFiles: [],
    });
  });
});
