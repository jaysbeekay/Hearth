"use client";

import { useState, useTransition } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { parseTradesCsv, importTrades } from "@/lib/actions/wealth";
import { buttonClass } from "@/lib/ui";
import { Pill } from "@/components/ui/Pill";
import { Banner } from "@/components/ui/Banner";

interface ParsedRow {
  ticker: string;
  type: string;
  date: string;
  units: number;
  pricePerUnit: number;
  fees: number;
  currency: string;
  assetClass?: "SHARE" | "CRYPTO";
}

interface Props {
  portfolioId: string;
}

export function WealthImportClient({ portfolioId }: Props) {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isParsing, startParse] = useTransition();
  const [isImporting, startImport] = useTransition();

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setRows([]);
    setParseError(null);
    setResult(null);

    const formData = new FormData();
    formData.set("file", file);

    startParse(async () => {
      const res = await parseTradesCsv(portfolioId, formData);
      if (res.error) {
        setParseError(res.error);
      } else {
        setRows(res.rows);
        if (!res.rows.length) setParseError("No valid trades found in the file.");
      }
    });
  }

  function handleImport() {
    startImport(async () => {
      const res = await importTrades(portfolioId, rows);
      if (res?.error) {
        setParseError(res.error);
      } else {
        setResult(res?.success ?? "Import complete.");
        setRows([]);
      }
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium mb-2">Upload CSV file</label>
        <p className="mb-3 text-sm text-muted">
          Supported formats: CommSec, SelfWealth, Stake, or generic (Date, Ticker, Type, Units, Price, Fees, Currency columns, plus an optional Asset Class or Exchange column; Crypto or CRYPTO marks a coin, otherwise rows import as shares).
        </p>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 hover:border-accent/50 transition-colors">
          <Upload size={20} className="text-muted" />
          <span className="text-sm text-muted">Choose CSV file…</span>
          <input type="file" accept=".csv" className="sr-only" onChange={handleFile} disabled={isParsing || isImporting} />
          {isParsing && <Loader2 size={16} className="animate-spin text-accent" />}
        </label>
      </div>

      {parseError && (
        <Banner tone="danger" className="flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {parseError}
        </Banner>
      )}

      {result && (
        <Banner tone="success" className="flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          {result}
        </Banner>
      )}

      {rows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{rows.length} trades found — review and confirm</p>
            <button
              onClick={handleImport}
              disabled={isImporting}
              className={`${buttonClass("primary")} disabled:opacity-50`}
            >
              {isImporting && <Loader2 size={16} className="animate-spin" />}
              Import {rows.length} trades
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-3 py-2">Ticker</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Units</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Fees</th>
                  <th className="px-3 py-2">Currency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-2 font-mono font-medium">
                      {row.ticker}
                      {row.assetClass === "CRYPTO" && <span className="ml-1 font-sans text-xs font-normal text-muted">Crypto</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Pill>
                        {row.type}
                      </Pill>
                    </td>
                    <td className="px-3 py-2">{row.date}</td>
                    <td className="px-3 py-2 text-right">{row.units.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{row.pricePerUnit.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right">{row.fees > 0 ? row.fees.toFixed(2) : "—"}</td>
                    <td className="px-3 py-2">{row.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
