import { FileSignature, Search } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";
import { openGlobalSearch } from "@/components/GlobalSearch";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
      <div className="flex items-center gap-2">
        <FileSignature size={20} className="text-accent" />
        <span className="font-semibold">Hearth</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label="Search"
          className="rounded-full p-2 text-muted hover:bg-black/5 dark:hover:bg-white/5"
        >
          <Search size={18} />
        </button>
        <SignOutButton />
      </div>
    </header>
  );
}
