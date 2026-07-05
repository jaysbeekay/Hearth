"use client";

import { useState, useTransition } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { parseTradesCsv, importTrades } from "@/lib/actions/wealth";

interface ParsedRow {
  ticker: string;
  type: string;
  date: string;
  units: number;
  pricePerUnit: number;
  fees: number;
  currency: string;
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
        <p className="mb-3 text-sm text-foreground/60">
          Supported formats: CommSec, SelfWealth, Stake, or generic (Date, Ticker, Type, Units, Price, Fees, Currency columns).
        </p>
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-6 hover:border-accent/50 transition-colors">
          <Upload size={20} className="text-foreground/50" />
          <span className="text-sm text-foreground/70">Choose CSV file…</span>
          <input type="file" accept=".csv" className="sr-only" onChange={handleFile} disabled={isParsing || isImporting} />
          {isParsing && <Loader2 size={16} className="animate-spin text-accent" />}
        </label>
      </div>

      {parseError && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          {parseError}
        </div>
      )}

      {result && (
        <div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          {result}
        </div>
      )}

      {rows.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{rows.length} trades found — review and confirm</p>
            <button
              onClick={handleImport}
              disabled={isImporting}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isImporting && <Loader2 size={14} className="animate-spin" />}
              Import {rows.length} trades
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-foreground/50">
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
                    <td className="px-3 py-2 font-mono font-semibold">{row.ticker}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.type === "BUY" ? "bg-success/10 text-success" :
                        row.type === "SELL" ? "bg-danger/10 text-danger" :
                        "bg-muted/10 text-muted"
                      }`}>
                        {row.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.date}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.units.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.pricePerUnit.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.fees > 0 ? row.fees.toFixed(2) : "—"}</td>
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
