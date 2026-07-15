import { FlaskConical } from "lucide-react";
import { isDemoMode } from "@/lib/env";

// Unlike NotificationNudgeBanner, this is never dismissible — it's warning
// about data loss on a shared account, not a one-time nudge, so it should
// reappear on every load rather than being hidden after the first dismiss.
export function DemoBanner() {
  if (!isDemoMode()) return null;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-info/30 bg-info/10 px-4 py-3 text-sm">
      <FlaskConical size={16} className="shrink-0 text-info" />
      <span className="flex-1 text-foreground">
        This is a public demo — shared by everyone browsing right now, and reset every hour.
        Nothing you enter here is private or kept.{" "}
        <a
          href="https://github.com/jaysbeekay/Hearth"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent hover:underline"
        >
          Get Hearth for yourself →
        </a>
      </span>
    </div>
  );
}
