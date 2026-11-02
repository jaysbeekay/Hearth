import Link from "next/link";
import { SETTINGS_ROUTES } from "@/lib/routeLabels";
import { inlineLinkClass } from "@/lib/ui";

/**
 * Under an empty list: how many of this list's records are in Trash, so an
 * empty list doesn't read as "the household has none" when they were only
 * deleted (#514 review). Renders nothing when Trash holds none.
 */
export function TrashHint({ count, singular, plural }: { count: number; singular: string; plural: string }) {
  if (count <= 0) return null;
  return (
    <p className="text-sm text-muted">
      {count} {count === 1 ? `${singular} is` : `${plural} are`} in{" "}
      <Link href={SETTINGS_ROUTES.trash.href} className={inlineLinkClass}>
        {SETTINGS_ROUTES.trash.label}
      </Link>{" "}
      and can be restored.
    </p>
  );
}
