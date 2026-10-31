import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

// #226 — the standalone shell's encrypted backup format
// (ios-shell/www/backup-format.js). The shell has no build step, so the file
// is plain script; it exports through module.exports when required here.

type BackupRecord = { type: string; [key: string]: unknown };
type Format = {
  FILE_PART_CHARS: number;
  createWriter(options: { password: string; schemaVersion: number; exportedAt: string; iterations?: number }): Promise<{
    headerLine: string;
    encrypt(record: BackupRecord): Promise<string>;
    end(): Promise<string>;
  }>;
  createReader(headerLine: string, password: string): Promise<{ header: { schemaVersion: number }; decrypt(line: string, index: number): Promise<BackupRecord> }>;
  parseHeader(headerLine: string): { schemaVersion: number } | null;
  fileRecords(key: string, base64: string): { type: "file"; key: string; seq: number; data: string }[];
  readLines(source: { size: number; readSlice(start: number, end: number): Promise<string> }, sliceBytes?: number): AsyncGenerator<string>;
  isSafeStorageKey(value: unknown): boolean;
  checkPassword(password: string): void;
};

const format: Format = createRequire(__filename)(path.join(__dirname, "..", "..", "ios-shell", "www", "backup-format.js"));

const PASSWORD = "correct horse battery";
// The format's floor, so the tests stay fast.
const ITERATIONS = 100000;

async function buildBackup(records: BackupRecord[], password = PASSWORD) {
  const writer = await format.createWriter({ password, schemaVersion: 11, exportedAt: "2099-01-01T00:00:00.000Z", iterations: ITERATIONS });
  const lines = [writer.headerLine];
  for (const record of records) lines.push(await writer.encrypt(record));
  lines.push(await writer.end());
  return lines;
}

async function readAll(lines: string[], password = PASSWORD) {
  const reader = await format.createReader(lines[0], password);
  const records: BackupRecord[] = [];
  for (let index = 1; index < lines.length; index += 1) records.push(await reader.decrypt(lines[index], index));
  return records;
}

describe("standalone backup format", () => {
  it("round-trips a manifest and document parts, ending with a record count", async () => {
    const manifest = { type: "manifest", tables: { contracts: [{ id: "c1", title: "Power" }] }, preferences: {} };
    const parts = format.fileRecords("contract/c1/a.pdf", "JVBERi0=");
    const lines = await buildBackup([manifest, ...parts]);
    const records = await readAll(lines);
    expect(records[0]).toEqual(manifest);
    expect(records[1]).toEqual({ type: "file", key: "contract/c1/a.pdf", seq: 0, data: "JVBERi0=" });
    expect(records.at(-1)).toEqual({ type: "end", records: 2 });
  });

  it("never writes record contents in the clear", async () => {
    const lines = await buildBackup([{ type: "manifest", tables: { contracts: [{ id: "c1", title: "Secret Insurer" }] } }]);
    expect(lines.join("\n")).not.toContain("Secret Insurer");
    expect(JSON.parse(lines[0])).toMatchObject({ kind: "hearth-standalone-backup", formatVersion: 2, schemaVersion: 11 });
  });

  it("rejects a wrong password on the first record", async () => {
    const lines = await buildBackup([{ type: "manifest", tables: {} }]);
    const reader = await format.createReader(lines[0], "not the password");
    await expect(reader.decrypt(lines[1], 1)).rejects.toThrow(/Wrong backup password/);
  });

  it("detects a changed header, reordered records and a record from another backup", async () => {
    const lines = await buildBackup([{ type: "manifest", tables: {} }, ...format.fileRecords("inbox/a.pdf", "QUJD")]);
    const editedHeader = lines[0].replace('"schemaVersion":11', '"schemaVersion":10');
    await expect((await format.createReader(editedHeader, PASSWORD)).decrypt(lines[1], 1)).rejects.toThrow();

    const reader = await format.createReader(lines[0], PASSWORD);
    await expect(reader.decrypt(lines[2], 1)).rejects.toThrow();

    const other = await buildBackup([{ type: "manifest", tables: {} }]);
    await expect(reader.decrypt(other[1], 1)).rejects.toThrow();
  });

  it("splits a document into parts that each decode on their own", () => {
    const data = "A".repeat(format.FILE_PART_CHARS * 2 + 8);
    const parts = format.fileRecords("inbox/big.pdf", data);
    expect(parts.map((part) => part.seq)).toEqual([0, 1, 2]);
    expect(parts.every((part) => part.data.length % 4 === 0)).toBe(true);
    expect(parts.map((part) => part.data).join("")).toBe(data);
    expect(format.fileRecords("inbox/empty.pdf", "")).toEqual([{ type: "file", key: "inbox/empty.pdf", seq: 0, data: "" }]);
  });

  it("reads lines across slice boundaries without loading the whole source", async () => {
    const text = ["header", "x".repeat(25), "y".repeat(3), "last"].join("\n") + "\n";
    const source = { size: text.length, readSlice: async (start: number, end: number) => text.slice(start, end) };
    const lines: string[] = [];
    for await (const line of format.readLines(source, 7)) lines.push(line);
    expect(lines).toEqual(["header", "x".repeat(25), "y".repeat(3), "last"]);
  });

  it("tells a v1 JSON backup apart and refuses a newer format", () => {
    expect(format.parseHeader("{")).toBeNull();
    expect(format.parseHeader(JSON.stringify({ kind: "hearth-standalone-backup", version: 1, tables: {} }))).toBeNull();
    expect(() => format.parseHeader(JSON.stringify({ kind: "hearth-standalone-backup", formatVersion: 3 }))).toThrow(/newer version/);
  });

  it("refuses encryption settings outside its bounds", async () => {
    const lines = await buildBackup([]);
    const header = JSON.parse(lines[0]);
    header.kdf.iterations = 10;
    expect(() => format.parseHeader(JSON.stringify(header))).toThrow(/out of range/);
  });

  it("requires a backup password of at least 8 characters", async () => {
    expect(() => format.checkPassword("short")).toThrow(/at least 8/);
    await expect(format.createWriter({ password: "short", schemaVersion: 11, exportedAt: "2099-01-01T00:00:00.000Z" })).rejects.toThrow(/at least 8/);
  });

  it("only accepts storage keys shaped like the ones the shell generates", () => {
    expect(format.isSafeStorageKey("contracts/contract_1/2f1c.pdf")).toBe(true);
    expect(format.isSafeStorageKey("inbox/2f1c.pdf")).toBe(true);
    for (const bad of ["../escape.pdf", "inbox/../../x", "/abs.pdf", "inbox//a.pdf", "inbox/a b.pdf", "", 42, null]) {
      expect(format.isSafeStorageKey(bad)).toBe(false);
    }
  });
});
