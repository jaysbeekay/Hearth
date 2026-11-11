// SPIKE #493 — NOT FOR MERGE. A standalone phone's own encrypted backups.
// Authenticated only by a per-device Bearer token (src/lib/deviceBackups.ts);
// excluded from src/proxy.ts's matcher so the proxy neither buffers (and
// truncates past proxyClientMaxBodySize) the upload body nor applies the
// cookie session/origin checks, which don't apply to a Bearer-token client.
import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice, corsHeaders, handleDeviceRequest, listBackups, storeUpload } from "@/lib/deviceBackups";

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function GET(request: NextRequest) {
  return handleDeviceRequest(request, async () => {
    const token = await authenticateDevice(request);
    return NextResponse.json({ backups: await listBackups(token.id) });
  });
}

export function POST(request: NextRequest) {
  return handleDeviceRequest(request, async () => {
    const token = await authenticateDevice(request);
    const row = await storeUpload(token.id, request);
    return NextResponse.json(
      { id: row.id, sizeBytes: row.sizeBytes, sha256: row.sha256, exportedAt: row.exportedAt, createdAt: row.createdAt },
      { status: 201 },
    );
  });
}
