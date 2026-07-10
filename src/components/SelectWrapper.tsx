import { ChevronDown } from "lucide-react";

export const selectClass =
  "w-full rounded-lg border border-border bg-background px-3 h-9 text-sm outline-none focus:border-accent appearance-none pr-8";

export function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        size={14}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
