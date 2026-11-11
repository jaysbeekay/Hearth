// SPIKE #493 (not for merge). Builds a real .hearthbackup with ~N MB of
// random "document" bytes using the shell's own backup-format.js, uploads it
// with the shell's server-backup.js, lists it, downloads it, checks the bytes
// are identical, then decrypts every record and checks the document came back.
//
//   node spike-493/large-roundtrip.mjs <serverUrl> <deviceToken> [megabytes]
import { createRequire } from "node:module";
import { createHash, randomBytes } from "node:crypto";

const require = createRequire(import.meta.url);
const format = require("../ios-shell/www/backup-format.js");
const client = require("../ios-shell/www/server-backup.js");
const [serverUrl, token, mbArg = "100"] = process.argv.slice(2);
const megabytes = Number(mbArg);
const password = "correct horse battery staple";
const sha = (value) => createHash("sha256").update(value).digest("hex");

const documentBytes = randomBytes(megabytes * 1024 * 1024);
const writer = await format.createWriter({ password, schemaVersion: 11, exportedAt: new Date().toISOString() });
const lines = [writer.headerLine];
lines.push(await writer.encrypt({ type: "manifest", tables: { contracts: [{ id: "c1", title: "Spike contract" }] }, preferences: {} }));
for (const record of format.fileRecords("documents/spike.bin", documentBytes.toString("base64"))) lines.push(await writer.encrypt(record));
lines.push(await writer.end());
const text = `${lines.join("\n")}\n`;
console.log(`backup: ${lines.length} lines, ${(Buffer.byteLength(text) / 1048576).toFixed(1)} MB on the wire`);

let t = Date.now();
const row = await client.upload({ serverUrl, token, body: text });
console.log(`upload: ${row.id} ${row.sizeBytes} bytes in ${Date.now() - t} ms, server sha256 ${row.sha256}`);
const listed = await client.list({ serverUrl, token });
if (!listed.some((entry) => entry.id === row.id)) throw new Error("not listed");
t = Date.now();
const blob = await client.download({ serverUrl, token, id: row.id });
const downloaded = Buffer.from(await blob.arrayBuffer());
console.log(`download: ${downloaded.length} bytes in ${Date.now() - t} ms`);
if (sha(downloaded) !== sha(Buffer.from(text))) throw new Error("download is not byte-identical");
console.log("byte-identical: yes");

const back = downloaded.toString("utf8").trim().split("\n");
const reader = await format.createReader(back[0], password);
const parts = [];
for (let i = 1; i < back.length; i += 1) {
  const record = await reader.decrypt(back[i], i);
  if (record.type === "file") parts.push(record.data);
}
const restored = Buffer.from(parts.join(""), "base64");
if (!restored.equals(documentBytes)) throw new Error("decrypted document differs");
console.log(`decrypt: ${back.length - 1} records, document (${restored.length} bytes) identical: yes`);
