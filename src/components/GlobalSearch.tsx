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
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  function closeSearch() {
    setOpen(false);
    previouslyFocusedRef.current?.focus();
  }

  function selectResult(result: SearchResult) {
    closeSearch();
    router.push(result.href);
  }

  useEffect(() => {
    const openSearch = () => {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      setQuery("");
      setGroups({});
      setActiveIndex(-1);
      setOpen(true);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_EVENT, openSearch);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_EVENT, openSearch);
    };
  }, []);

  useEffect(() => {
    if (open) {
      // Focus after the overlay has mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        previouslyFocusedRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      return;
    }
    const timeout = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data) => {
          setGroups(data.groups ?? {});
          setActiveIndex(-1);
        })
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(timeout);
  }, [query, open]);

  if (!open) return null;

  const groupEntries = query.trim().length >= 2 ? Object.entries(groups) : [];
  const flatResults = groupEntries.flatMap(([, results]) => results);
  const hasResults = flatResults.length > 0;
  const showEmpty = !loading && query.trim().length >= 2 && !hasResults;
  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]"
      onClick={closeSearch}
    >
      <div
        role="dialog"
        aria-label="Search"
        aria-modal="true"
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search size={18} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={hasResults}
            aria-controls="global-search-listbox"
            aria-activedescendant={activeIndex >= 0 ? `global-search-option-${activeIndex}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                if (flatResults.length > 0) {
                  setActiveIndex((i) => (i + 1) % flatResults.length);
                }
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (flatResults.length > 0) {
                  setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
                }
              } else if (e.key === "Enter") {
                if (activeIndex >= 0 && flatResults[activeIndex]) {
                  e.preventDefault();
                  selectResult(flatResults[activeIndex]);
                }
              } else if (e.key === "Escape") {
                closeSearch();
              } else if (e.key === "Tab") {
                // Trap focus inside the dialog: only the input and the
                // close button are real tab stops.
                e.preventDefault();
                closeButtonRef.current?.focus();
              }
            }}
            placeholder="Search contracts, products, documents…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeSearch}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                inputRef.current?.focus();
              }
            }}
            aria-label="Close search"
            className="shrink-0 rounded-md p-1 text-muted hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X size={16} />
          </button>
        </div>

        <div id="global-search-listbox" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
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
              {results.map((r) => {
                flatIndex++;
                const isActive = flatIndex === activeIndex;
                return (
                  <button
                    key={`${group}-${r.id}`}
                    id={`global-search-option-${flatIndex}`}
                    role="option"
                    aria-selected={isActive}
                    tabIndex={-1}
                    type="button"
                    onClick={() => selectResult(r)}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    className={`flex w-full flex-col items-start rounded-lg px-3 py-2 text-left ${
                      isActive ? "bg-black/5 dark:bg-white/5" : "hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    {r.subtitle && <span className="truncate text-xs text-muted">{r.subtitle}</span>}
                    {r.matchedInDocument && (
                      <span className="text-[11px] italic text-muted">Matched inside an attached document</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
