import Link from "next/link";
import type { VehicleModel } from "@/generated/prisma/models";
import { formatDate } from "@/lib/utils";
import { isDue } from "@/lib/duePolicy";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { StatusPill } from "@/components/StatusPill";
import { vehicleDue, type DueContext } from "@/lib/dueRecords";

export function VehicleCard({
  vehicle,
  due,
  dateFormat,
  missing,
}: {
  vehicle: VehicleModel & { _count?: { items: number; contracts?: number } };
  /** #384 — the household's today and default thresholds, for the Due policy. */
  due: DueContext;
  dateFormat?: string;
  /** #395 — which key details are missing, shown when the list is filtered to them. */
  missing?: string[];
}) {
  const subtitle = [vehicle.make, vehicle.model, vehicle.year, vehicle.licensePlate]
    .filter(Boolean)
    .join(" · ");
  const dueNow = vehicleDue(vehicle, due).filter(isDue);

  return (
    <Link
      href={`/vehicles/${vehicle.id}`}
      className="block min-w-0 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent/50"
    >
      <div className="min-w-0">
        {subtitle && <p className="truncate text-sm text-muted">{subtitle}</p>}
        <p className="truncate font-medium">{vehicle.label}</p>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {/* #384 — one pill per Due entry (rego, insurance, service), each
              with its own state, label and tone from the Due policy (#412). */}
          {dueNow.map((entry) => (
            <ExpiryBadge key={entry.field} entry={entry} />
          ))}
          {/* #355 — an Archived Vehicle has no Due entries; it says so instead. */}
          {vehicle.archivedAt && <StatusPill status="archived">Archived</StatusPill>}
        </div>

        {vehicle._count != null && (
          <span className="text-sm text-muted">
            {vehicle._count.items} {vehicle._count.items === 1 ? "service record" : "service records"}
            {/* #293 — linked-record count, mirroring PropertyCard's. */}
            {vehicle._count.contracts != null && ` · ${vehicle._count.contracts} linked`}
          </span>
        )}
      </div>

      {missing && missing.length > 0 && (
        <p className="mt-1 text-xs font-medium text-muted">{missing.join(" · ")}</p>
      )}

      {(vehicle.regoExpiry || vehicle.insuranceExpiry || vehicle.nextServiceDue) && (
        <div className="mt-2 flex flex-wrap gap-4">
          {vehicle.regoExpiry && (
            <p className="text-xs text-muted">Rego: {formatDate(vehicle.regoExpiry, dateFormat)}</p>
          )}
          {vehicle.insuranceExpiry && (
            <p className="text-xs text-muted">
              Insurance: {formatDate(vehicle.insuranceExpiry, dateFormat)}
            </p>
          )}
          {vehicle.nextServiceDue && (
            <p className="text-xs text-muted">
              Service: {formatDate(vehicle.nextServiceDue, dateFormat)}
            </p>
          )}
        </div>
      )}
    </Link>
  );
}
