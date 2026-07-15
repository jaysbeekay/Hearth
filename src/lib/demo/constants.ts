// Fixed identifiers for the single shared demo account. The reset job
// deletes and recreates this exact user every hour, so the id must be
// stable across resets rather than a fresh cuid each time.
export const DEMO_USER_ID = "demo-shared-account-0001";
export const DEMO_USER_EMAIL = "demo@hearth.invalid";
export const DEMO_USER_NAME = "Demo Visitor";
