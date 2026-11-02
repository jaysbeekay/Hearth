import { Flame, Search } from "lucide-react";
import { openGlobalSearch } from "@/components/GlobalSearch";
import { buttonClass } from "@/lib/ui";

// Phones only. Navigation lives in the bottom bar and its More sheet (#407),
// so this bar carries just the name and Search.
export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] md:hidden">
      <div className="flex items-center gap-2">
        <Flame size={20} className="text-accent" />
        <span className="font-medium">Hearth</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label="Search"
          className={buttonClass("quiet", { icon: true }, "text-muted")}
        >
          <Search size={20} />
        </button>
      </div>
    </header>
  );
}
