import { redirect } from "next/navigation";

// #363 — "System settings" is split across the Household tab. Old links
// and bookmarks land on its most-visited part.
export default function AppSettingsRedirect() {
  redirect("/settings/reminders");
}
