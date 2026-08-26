import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { normaliseGeocodeResult, type NominatimResult } from "@/lib/geocode";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim();
  if (!q || q.length < 3) {
    return NextResponse.json([]);
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, {
    headers: { "User-Agent": "Hearth/1.0" },
  });
  if (!res.ok) {
    return NextResponse.json({ error: "Lookup failed." }, { status: 502 });
  }

  const results = (await res.json()) as NominatimResult[];
  return NextResponse.json(results.map(normaliseGeocodeResult));
}
