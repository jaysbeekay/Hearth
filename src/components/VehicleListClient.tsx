"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { VehicleCard } from "@/components/VehicleCard";
import type { VehicleModel } from "@/generated/prisma/models";
import { cachePageData } from "@/lib/offlineCache";

type VehicleWithCount = VehicleModel & { _count: { items: number } };

interface Props {
  vehicles: VehicleWithCount[];
}

export function VehicleListClient({ vehicles }: Props) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    cachePageData("vehicles:list", vehicles).catch(() => {});
  }, [vehicles]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Vehicles</h1>
        <Link
          href="/vehicles/new"
          aria-disabled={!online}
          tabIndex={!online ? -1 : undefined}
          className={`flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90${!online ? " pointer-events-none opacity-40" : ""}`}
        >
          <Plus size={16} />
          Add vehicle
        </Link>
      </div>

      {vehicles.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-foreground/60">
          No vehicles yet. Add your first vehicle to start tracking rego, insurance, and service history.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      )}
    </div>
  );
}
