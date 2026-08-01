import { NextResponse } from "next/server";
import { MOBILE_CAPABILITIES } from "@/lib/mobile/capabilityModel";
import { env } from "@/lib/env";

export async function GET() {
  return NextResponse.json({
    serverInstanceId: new URL(env.appUrl).origin,
    product: "hearth",
    apiVersion: "mobile-v1",
    minAppVersion: null,
    capabilities: MOBILE_CAPABILITIES.map((item) => item.key),
  });
}
