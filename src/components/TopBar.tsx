import { Flame, Search } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";
import { openGlobalSearch } from "@/components/GlobalSearch";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
      <div className="flex items-center gap-2">
        <Flame size={20} className="text-accent" />
        <span className="font-semibold">Hearth</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label="Search"
          className="flex size-11 items-center justify-center rounded-full text-muted hover:bg-black/5 dark:hover:bg-white/5"
        >
          <Search size={18} />
        </button>
        <SignOutButton className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm text-foreground/70 hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5" />
      </div>
    </header>
  );
}
