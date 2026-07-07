import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { fetchHistoricalPrice } from "@/lib/prices";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ price: null }, { status: 401 });
  if (!(await isModuleEnabled("WEALTH"))) return NextResponse.json({ price: null }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get("ticker")?.trim().toUpperCase() ?? "";
  const dateStr = searchParams.get("date") ?? "";

  if (!ticker || !dateStr) return NextResponse.json({ price: null });

  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return NextResponse.json({ price: null });

  const price = await fetchHistoricalPrice(ticker, date);
  return NextResponse.json({ price });
}
