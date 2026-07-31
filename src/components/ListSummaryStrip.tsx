// A compact row of at-a-glance stats above a list, so a page with only one
// or two records still has useful context instead of a card in the corner
// and empty space (#177). Shown above the grid whenever there's at least
// one record and no active search/filter.
export function ListSummaryStrip({
  items,
}: {
  items: { label: string; value: number; tone?: "warning" | "danger" }[];
}) {
  const visible = items.filter((item) => item.value > 0);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {visible.map((item) => (
        <span
          key={item.label}
          className={`rounded-full border px-3 py-1 ${
            item.tone === "danger"
              ? "border-danger/30 bg-danger/10 text-danger"
              : item.tone === "warning"
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-border bg-surface text-muted"
          }`}
        >
          {item.value} {item.label}
        </span>
      ))}
    </div>
  );
}
