// A compact row of at-a-glance stats above a list, so a page with only one
// or two records still has useful context instead of a card in the corner
// and empty space (#177). Shown above the grid whenever there's at least
// one record and no active search/filter.
//
// #305: these used to render as pills identical to the clickable filter
// chips shown just above, but did nothing on click — a false affordance.
// An item with `onClick` (its count has a matching filter) renders as a real
// button; one without renders as plain text so it doesn't look clickable.
import { statusBannerClass, statusTextClass, statusTone, type RecordStatus, type StatusTone } from "@/lib/statusTone";
import { chipShapeClass } from "@/lib/ui";

// #412 — a count takes its status's tone: only Overdue and Due soon are
// coloured, with the same tint and border as a status banner.
function buttonClass(tone: StatusTone): string {
  return `${chipShapeClass} ${
    tone === "danger" || tone === "warning" ? statusBannerClass(tone) : "border-border bg-surface text-muted hover:bg-hover-surface"
  }`;
}

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
            className={buttonClass(tone)}
          >
            {item.value} {item.label}
          </button>
        ) : (
          <span
            key={item.label}
            className={`px-1 py-1 ${statusTextClass(tone)}`}
          >
            {item.value} {item.label}
          </span>
        );
      })}
    </div>
  );
}
