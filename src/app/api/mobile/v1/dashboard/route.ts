import { NextResponse } from "next/server";
import {
  buildDashboardSummary,
  requireMobileUser,
} from "@/app/api/mobile/v1/_lib/mobileApi";

export async function GET() {
  const auth = await requireMobileUser();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await buildDashboardSummary());
}
