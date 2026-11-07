// #375 — shared by the server (health, sender) and the Settings device list.

/** Whether a device's latest push failed, with no success since. */
export function pushDeviceFailing(d: { lastSuccessAt: Date | null; lastFailureAt: Date | null }): boolean {
  return d.lastFailureAt != null && (d.lastSuccessAt == null || d.lastFailureAt > d.lastSuccessAt);
}
