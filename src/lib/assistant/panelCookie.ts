// Remembers, per browser, whether the assistant side panel is open. Read by
// the app layout so the first render already has the panel in place.
export const ASSISTANT_PANEL_COOKIE = "hearth-assistant-panel";

/** Closed until this browser opens it; the rail beside the page opens it. */
export function isAssistantPanelOpen(cookieValue: string | undefined): boolean {
  return cookieValue === "open";
}
