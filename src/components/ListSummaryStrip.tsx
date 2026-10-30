// A compact row of at-a-glance stats above a list, so a page with only one
// or two records still has useful context instead of a card in the corner
// and empty space (#177). Shown above the grid whenever there's at least
// one record and no active search/filter.
//
// #305: these used to render as pills identical to the clickable filter
// chips shown just above, but did nothing on click — a false affordance.
// An item with `onClick` (its count has a matching filter) renders as a real
// button; one without renders as plain text so it doesn't look clickable.
import { statusTone, type RecordStatus, type StatusTone } from "@/lib/statusTone";

// #412 — a count takes its status's tone: only Overdue and Due soon are coloured.
const BUTTON_CLASS = new Map<StatusTone, string>([
  ["danger", "border-danger/30 bg-danger/10 text-danger"],
  ["warning", "border-warning/30 bg-warning/10 text-warning"],
]);
const TEXT_CLASS = new Map<StatusTone, string>([
  ["danger", "text-danger"],
  ["warning", "text-warning"],
]);

export function ListSummaryStrip({
  items,
}: {
  items: {
    label: string;
    value: number;
    /** The status the count is of, which sets its tone; plain when absent. */
    status?: RecordStatus;
    onClick?: () => void;
  }[];
}) {
  const visible = items.filter((item) => item.value > 0);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {visible.map((item) => {
        const tone = item.status ? statusTone(item.status) : "plain";
        return item.onClick ? (
          <button
            key={item.label}
            type="button"
            onClick={item.onClick}
            className={`rounded-full border px-3 py-1 hover:bg-hover ${
              BUTTON_CLASS.get(tone) ?? "border-border bg-surface text-muted"
            }`}
          >
            {item.value} {item.label}
          </button>
        ) : (
          <span
            key={item.label}
            className={`px-1 py-1 ${TEXT_CLASS.get(tone) ?? "text-muted"}`}
          >
            {item.value} {item.label}
          </span>
        );
      })}
    </div>
  );
}
