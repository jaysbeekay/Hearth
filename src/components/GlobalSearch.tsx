"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import type { SearchResult } from "@/app/api/search/route";

const OPEN_EVENT = "hearth:open-search";

export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<Record<string, SearchResult[]>>({});
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    const onOpenEvent = () => setOpen(true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setGroups({});
      // Focus after the overlay has mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setGroups({});
      return;
    }
    setLoading(true);
    const timeout = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data) => setGroups(data.groups ?? {}))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, open]);

  if (!open) return null;

  const groupEntries = Object.entries(groups);
  const hasResults = groupEntries.length > 0;
  const showEmpty = !loading && query.trim().length >= 2 && !hasResults;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search size={18} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contracts, products, documents…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close search"
            className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {query.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Type at least 2 characters to search.
            </p>
          )}
          {showEmpty && (
            <p className="px-3 py-6 text-center text-sm text-muted">
              No results for &quot;{query.trim()}&quot;.
            </p>
          )}
          {groupEntries.map(([group, results]) => (
            <div key={group} className="mb-2">
              <p className="px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                {group}
              </p>
              {results.map((r) => (
                <button
                  key={`${group}-${r.id}`}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(r.href);
                  }}
                  className="flex w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <span className="truncate text-sm font-medium">{r.title}</span>
                  {r.subtitle && <span className="truncate text-xs text-muted">{r.subtitle}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
