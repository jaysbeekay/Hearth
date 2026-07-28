import path from "path";

export const PORT = 3000;
export const BASE_URL = `http://localhost:${PORT}`;

export const DATA_DIR = path.join(__dirname, ".data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const DATABASE_URL = `file:${path.join(DATA_DIR, "app.db")}`;

export const AUTH_DIR = path.join(DATA_DIR, "auth");
export const ADMIN_AUTH_FILE = path.join(AUTH_DIR, "admin.json");
export const MEMBER_AUTH_FILE = path.join(AUTH_DIR, "member.json");
export const FIXTURES_FILE = path.join(DATA_DIR, "fixtures.json");

// Throwaway secret for the ephemeral, gitignored DB this suite seeds and
// destroys on every run — never used against real data.
export const AUTH_SECRET = "e2e-suite-secret-not-for-production-0000000000";

// Throwaway encryption key so the AI Assistant/BYOK settings sections (gated
// on isEncryptionConfigured()) render during e2e runs.
export const ENCRYPTION_KEY = "F0CiTt+ImWBEgZWCI0tjldALraXIJ5XDLAvTWQqrRmI=";

export const ADMIN_EMAIL = "admin@e2e.local";
export const ADMIN_PASSWORD = "E2eTestPassw0rd!23";
export const MEMBER_EMAIL = "member@e2e.local";
export const MEMBER_PASSWORD = "E2eTestPassw0rd!23";

export interface Fixtures {
  tripAId: string;
}
