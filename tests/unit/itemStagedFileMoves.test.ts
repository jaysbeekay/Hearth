import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queueStagedFileMove, withStagedFileMoves } from "@/lib/items/stagedFileMoves";

// #445 review: staged Document copies happen after the legacy write commits,
// and a failed copy never fails the legacy write.
describe("staged Item Document file moves", () => {
  const root = mkdtempSync(path.join(tmpdir(), "hearth-staged-moves-"));
  const from = path.join(root, "items", "old", "a.pdf");
  const to = path.join(root, "items", "new", "a.pdf");
  mkdirSync(path.dirname(from), { recursive: true });
  writeFileSync(from, "bytes");

  afterEach(() => vi.restoreAllMocks());

  it("copies only after the write resolves", async () => {
    const result = await withStagedFileMoves(async () => {
      queueStagedFileMove({ documentId: "doc", from, to });
      expect(existsSync(to)).toBe(false);
      return "committed";
    });
    expect(result).toBe("committed");
    expect(readFileSync(to, "utf8")).toBe("bytes");
  });

  it("copies nothing when the write throws", async () => {
    const other = path.join(root, "items", "rolled-back", "a.pdf");
    await expect(
      withStagedFileMoves(async () => {
        queueStagedFileMove({ documentId: "doc", from, to: other });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(existsSync(other)).toBe(false);
  });

  it("keeps the legacy write when the staged copy is missing, and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const missing = path.join(root, "items", "old", "missing.pdf");
    await expect(
      withStagedFileMoves(async () => {
        queueStagedFileMove({ documentId: "missing-doc", from: missing, to: path.join(root, "items", "new", "missing.pdf") });
        return "committed";
      }),
    ).resolves.toBe("committed");
    expect(error).toHaveBeenCalledWith(expect.stringContaining("couldn't copy staged Document"), "missing-doc", expect.anything());
  });

  it("accepts an identical file already at the destination and logs a different one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await withStagedFileMoves(async () => queueStagedFileMove({ documentId: "same", from, to }));
    expect(error).not.toHaveBeenCalled();
    writeFileSync(to, "other bytes");
    await withStagedFileMoves(async () => queueStagedFileMove({ documentId: "differs", from, to }));
    expect(error).toHaveBeenCalledWith(expect.any(String), "differs", expect.anything());
    expect(readFileSync(to, "utf8")).toBe("other bytes");
  });

  it("never copies when the writer isn't wrapped", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unwrapped = path.join(root, "items", "unwrapped", "a.pdf");
    queueStagedFileMove({ documentId: "loose", from, to: unwrapped });
    expect(existsSync(unwrapped)).toBe(false);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("isn't wrapped"), "loose");
  });
});
