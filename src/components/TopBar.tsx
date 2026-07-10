import { FileSignature } from "lucide-react";
import { SignOutButton } from "@/components/SignOutButton";

export function TopBar() {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
      <div className="flex items-center gap-2">
        <FileSignature size={20} className="text-accent" />
        <span className="font-semibold">Hearth</span>
      </div>
      <SignOutButton />
    </header>
  );
}
