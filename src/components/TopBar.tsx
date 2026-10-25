import { Flame, Search } from "lucide-react";
import { openGlobalSearch } from "@/components/GlobalSearch";

// Phones only. Navigation lives in the bottom bar and its More sheet (#407),
// so this bar carries just the name and Search.
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:hidden">
      <div className="flex items-center gap-2">
        <Flame size={20} className="text-accent" />
        <span className="font-semibold">Hearth</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label="Search"
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-hover"
        >
          <Search size={18} />
        </button>
      </div>
    </header>
  );
}
