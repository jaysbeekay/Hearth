import { redirect } from "next/navigation";

// #363 — Webhooks moved into Household settings → Integrations.
export default function WebhooksRedirect() {
  redirect("/settings/integrations");
}
