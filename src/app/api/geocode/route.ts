import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

interface NominatimAddress {
  house_number?: string;
  road?: string;
  suburb?: string;
  neighbourhood?: string;
  city_district?: string;
  city?: string;
  town?: string;
  village?: string;
  state?: string;
  postcode?: string;
  country?: string;
}

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  address?: NominatimAddress;
}

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
  return NextResponse.json(
    results.map((r) => {
      const a = r.address ?? {};
      const street = [a.house_number, a.road].filter(Boolean).join(" ");
      const suburb = a.suburb || a.neighbourhood || a.city_district || a.city || a.town || a.village || "";
      return {
        display_name: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
        street,
        suburb,
        state: a.state ?? "",
        postcode: a.postcode ?? "",
        country: a.country ?? "",
      };
    }),
  );
}
