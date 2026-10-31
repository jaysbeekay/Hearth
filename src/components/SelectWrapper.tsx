import { ChevronDown } from "lucide-react";

// #411 — one 36px input/select style, defined in src/lib/ui.ts.
export { inputClass, selectClass, textareaClass } from "@/lib/ui";

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
