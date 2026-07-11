import Link from "next/link";
import type { VehicleModel } from "@/generated/prisma/models";
import { daysUntil, formatDate } from "@/lib/utils";

function ExpiryWarning({ label, date }: { label: string; date: Date | null | undefined }) {
  if (!date) return null;
  const days = daysUntil(date);
  if (days == null || days > 30) return null;
  const text =
    days < 0
      ? `${label} expired`
      : days === 0
        ? `${label} expires today`
        : `${label} in ${days}d`;
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
      {text}
    </span>
  );
}

export function VehicleCard({
  vehicle,
  dateFormat,
}: {
  vehicle: VehicleModel & { _count?: { items: number } };
  dateFormat?: string;
}) {
  const subtitle = [vehicle.make, vehicle.model, vehicle.year, vehicle.licensePlate]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/vehicles/${vehicle.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 shadow-stripe transition hover:border-accent/50"
    >
      <div className="min-w-0">
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        <p className="truncate font-medium">{vehicle.label}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <ExpiryWarning label="Rego" date={vehicle.regoExpiry} />
          <ExpiryWarning label="Insurance" date={vehicle.insuranceExpiry} />
        </div>

        {vehicle._count != null && (
          <span className="text-sm text-muted tabular-nums">
            {vehicle._count.items} {vehicle._count.items === 1 ? "record" : "records"}
          </span>
        )}
      </div>

      {(vehicle.regoExpiry || vehicle.insuranceExpiry) && (
        <div className="mt-2 flex flex-wrap gap-4">
          {vehicle.regoExpiry && (
            <p className="text-xs text-muted">Rego: {formatDate(vehicle.regoExpiry, dateFormat)}</p>
          )}
          {vehicle.insuranceExpiry && (
            <p className="text-xs text-muted">
              Insurance: {formatDate(vehicle.insuranceExpiry, dateFormat)}
            </p>
          )}
        </div>
      )}
    </Link>
  );
}
