import { requireModuleEnabled } from "@/lib/modules/enablement";
import { createTrip } from "@/lib/actions/trips";
import { TripForm } from "@/components/TripForm";
import { BackLink } from "@/components/BackLink";
import { auth } from "@/lib/auth";
import { redirectIfReadOnly } from "@/lib/readOnly";
import { Card } from "@/components/ui/Card";

export default async function NewTripPage() {
  await requireModuleEnabled("TRAVEL");
  redirectIfReadOnly(await auth(), "/travel");

  return (
    <div className="max-w-3xl space-y-6">
      <BackLink href="/travel" label="Travel" />
      <div>
        <h1 className="text-2xl font-medium">Add a trip</h1>
        <p className="text-sm text-muted">
          Start an itinerary, then add flights, lodging, and activities.
        </p>
      </div>
      <Card>
        <TripForm action={createTrip} />
      </Card>
    </div>
  );
}
