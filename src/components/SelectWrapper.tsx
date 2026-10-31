import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass } from "@/lib/ui";

// #411 — the one 36px input/select look lives in lib/ui; these re-exports
// keep the forms' existing imports working.
export { inputClass, textareaClass } from "@/lib/ui";

export const selectClass = cn(inputClass, "appearance-none pr-8");

export function SelectWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown
        size={16}
        aria-hidden
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
