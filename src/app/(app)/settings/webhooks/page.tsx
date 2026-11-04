import { redirect } from "next/navigation";

// #363 — Webhooks moved into Settings → Household → Integrations.
export default function WebhooksRedirect() {
  redirect("/settings/integrations");
}
