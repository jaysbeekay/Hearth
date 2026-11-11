// SPIKE #493 — NOT FOR MERGE. Downloads one of the calling device's backups,
// byte for byte. See ../route.ts.
import { NextRequest, NextResponse } from "next/server";
import { authenticateDevice, corsHeaders, handleDeviceRequest, openBackup } from "@/lib/deviceBackups";

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return handleDeviceRequest(request, async () => {
    const token = await authenticateDevice(request);
    const { id } = await ctx.params;
    const { row, size, stream } = await openBackup(token.id, id);
    return new NextResponse(stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(size),
        "content-disposition": `attachment; filename="hearth-${row.id}.hearthbackup"`,
        "x-backup-sha256": row.sha256,
      },
    });
  });
}
