import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules/enablement";
import { fetchHistoricalPrice, getQuoteCurrency } from "@/lib/prices";

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

  // The close is in the ticker's quote currency; send it along (when a
  // price refresh has cached it) so the Trade form can label it (#404).
  const [price, currency] = await Promise.all([fetchHistoricalPrice(ticker, date), getQuoteCurrency(ticker)]);
  return NextResponse.json({ price, currency: price != null ? currency : null });
}
