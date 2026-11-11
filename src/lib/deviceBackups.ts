// SPIKE #493 — NOT FOR MERGE. Prototype of a standalone phone pushing its own
// encrypted .hearthbackup files to the household's Hearth server.
//
// The server is a dumb, size-capped, per-device mailbox for ciphertext:
//  - It never sees the backup password, and never decrypts anything.
//  - It checks only that the first line is a v2 .hearthbackup header, so it
//    is not an arbitrary file drop.
//  - Files are stored under server-generated names (uuid), in a folder named
//    by the token's id (a cuid), never by anything the client sent.
//  - Each device keeps at most DEVICE_BACKUP_RETENTION_COUNT backups, pruned
//    newest-first the way src/lib/backup/ prunes the server's own backups,
//    with the DB row and the file deleted together.
import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream } from "fs";
import { mkdir, rename, rm, stat, unlink } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit, clientAddress, recordFailedAttempt } from "@/lib/rateLimit";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";

const FILE_EXTENSION = ".hearthbackup";
const HEADER_KIND = "hearth-standalone-backup";
const MAX_HEADER_CHARS = 4096;

export function deviceBackupConfig() {
  return {
    dir: path.resolve(process.env.DEVICE_BACKUP_DIR ?? "./data/device-backups"),
    // 512 MB default; the prototype run lowers it to prove the cap.
    maxBytes: Number(process.env.DEVICE_BACKUP_MAX_BYTES ?? 512 * 1024 * 1024),
    retentionCount: Math.max(1, Number(process.env.DEVICE_BACKUP_RETENTION_COUNT ?? 5)),
    // The shell's WebView origins. A Bearer header (not a cookie) is the
    // credential, so CORS is not the security boundary, only hygiene.
    corsOrigins: (process.env.DEVICE_BACKUP_CORS_ORIGINS ?? "capacitor://localhost,https://localhost,http://localhost")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

export class DeviceBackupError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function corsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    vary: "Origin",
  };
  if (origin && deviceBackupConfig().corsOrigins.includes(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
    headers["access-control-allow-headers"] = "authorization, content-type";
    headers["access-control-expose-headers"] = "x-backup-sha256";
    headers["access-control-max-age"] = "600";
  }
  return headers;
}

// Returns the token row, or throws 401. Same answer for "missing", "unknown"
// and "revoked" so a caller learns nothing about which.
export async function authenticateDevice(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  if (!match) throw new DeviceBackupError(401, "Unauthorized");
  const token = await prisma.deviceBackupToken.findUnique({ where: { tokenHash: hashToken(match[1]) } });
  if (!token || token.revokedAt) throw new DeviceBackupError(401, "Unauthorized");
  await prisma.deviceBackupToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  return token;
}

function deviceDir(tokenId: string): string {
  // tokenId is a cuid from our own DB, but check anyway: it becomes a path.
  if (!/^[a-z0-9]{20,40}$/.test(tokenId)) throw new DeviceBackupError(500, "Bad device id");
  return path.join(deviceBackupConfig().dir, tokenId);
}

// Checks line 0 is a v2 .hearthbackup header. Structure only: the header
// holds the KDF salt and iteration count, nothing secret.
function parseHeaderLine(line: string): { exportedAt: Date | null } {
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(line);
  } catch {
    throw new DeviceBackupError(400, "Not a Hearth backup");
  }
  if (!header || header.kind !== HEADER_KIND || header.formatVersion !== 2 || header.cipher !== "AES-256-GCM") {
    throw new DeviceBackupError(400, "Not an encrypted Hearth backup");
  }
  const exportedAt = typeof header.exportedAt === "string" ? new Date(header.exportedAt) : null;
  return { exportedAt: exportedAt && !Number.isNaN(exportedAt.getTime()) ? exportedAt : null };
}

// Streams the body to a temp file, enforcing the size cap as it goes (a
// missing or lying Content-Length is not trusted), hashing, and checking the
// header from the first bytes. Then renames into place and prunes.
export async function storeUpload(tokenId: string, request: NextRequest) {
  const { maxBytes, retentionCount } = deviceBackupConfig();
  const declared = Number(request.headers.get("content-length") ?? NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new DeviceBackupError(413, "Backup too large");
  if (!request.body) throw new DeviceBackupError(400, "Empty body");

  const dir = deviceDir(tokenId);
  await mkdir(dir, { recursive: true });
  const storageName = `${randomUUID()}${FILE_EXTENSION}`;
  const tempPath = path.join(dir, `.${storageName}.part`);
  const finalPath = path.join(dir, storageName);

  const hash = createHash("sha256");
  const out = createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
  let size = 0;
  let headerText = "";
  let headerChecked = false;
  let exportedAt: Date | null = null;
  const decoder = new TextDecoder();
  try {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new DeviceBackupError(413, "Backup too large");
      }
      if (!headerChecked) {
        headerText += decoder.decode(value, { stream: true });
        const newline = headerText.indexOf("\n");
        if (newline >= 0) {
          ({ exportedAt } = parseHeaderLine(headerText.slice(0, newline)));
          headerChecked = true;
        } else if (headerText.length > MAX_HEADER_CHARS) {
          throw new DeviceBackupError(400, "Not a Hearth backup");
        }
      }
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
    if (!headerChecked) throw new DeviceBackupError(400, "Not a Hearth backup");
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    await rename(tempPath, finalPath);
  } catch (error) {
    out.destroy();
    await rm(tempPath, { force: true });
    throw error;
  }

  const sha256 = hash.digest("hex");
  const row = await prisma.deviceBackup.create({ data: { tokenId, storageName, sizeBytes: size, sha256, exportedAt } });
  await pruneDevice(tokenId, retentionCount);
  return row;
}

// Keep the newest `retentionCount` per device, by createdAt (the same rule as
// pruneLocal/pruneS3/pruneSftp: newest-first, drop the rest).
export async function pruneDevice(tokenId: string, retentionCount: number) {
  const stale = await prisma.deviceBackup.findMany({
    where: { tokenId },
    orderBy: { createdAt: "desc" },
    skip: retentionCount,
  });
  for (const row of stale) {
    await unlink(path.join(deviceDir(tokenId), row.storageName)).catch(() => undefined);
    await prisma.deviceBackup.delete({ where: { id: row.id } });
  }
}

export function listBackups(tokenId: string) {
  return prisma.deviceBackup.findMany({
    where: { tokenId },
    orderBy: { createdAt: "desc" },
    select: { id: true, sizeBytes: true, sha256: true, exportedAt: true, createdAt: true },
  });
}

// Scoped to the calling device: another device's id is a 404, not a 403.
export async function openBackup(tokenId: string, id: string) {
  if (!/^[a-z0-9]{20,40}$/.test(id)) throw new DeviceBackupError(404, "Not found");
  const row = await prisma.deviceBackup.findFirst({ where: { id, tokenId } });
  if (!row) throw new DeviceBackupError(404, "Not found");
  const filePath = path.join(deviceDir(tokenId), row.storageName);
  const { size } = await stat(filePath).catch(() => {
    throw new DeviceBackupError(404, "Not found");
  });
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
  return { row, size, stream };
}

// Wraps a route: CORS headers on every answer, a per-address throttle on
// wrong tokens, and errors mapped to a status without leaking details.
export async function handleDeviceRequest(request: NextRequest, run: () => Promise<NextResponse>) {
  const headers = corsHeaders(request);
  const address = clientAddress(request.headers);
  const limited = checkRateLimit("deviceBackupAuth", address);
  if (!limited.allowed) return NextResponse.json({ error: "Too many attempts" }, { status: 429, headers });
  try {
    const response = await run();
    for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
    return response;
  } catch (error) {
    if (error instanceof DeviceBackupError) {
      if (error.status === 401) recordFailedAttempt("deviceBackupAuth", address);
      return NextResponse.json({ error: error.message }, { status: error.status, headers });
    }
    console.error("[device-backups]", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json({ error: "Server error" }, { status: 500, headers });
  }
}
