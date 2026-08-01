import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import type { MobileRuntimeMode } from "@/lib/mobile/capabilityModel";
import { MOBILE_RUNTIME_MODES } from "@/lib/mobile/capabilityModel";
import type { StandaloneProfileRecord } from "@/lib/mobile/standaloneStore";
import {
  createStandaloneId,
  getStandaloneDb,
  nowIso,
} from "@/lib/mobile/standaloneStore";
import {
  isNativeStandaloneStorageAvailable,
  nativeQuery,
  nativeRun,
} from "@/lib/mobile/nativeStandaloneStore";

const RUNTIME_MODE_KEY = "hearth.mobile.runtimeMode";
const STANDALONE_PROFILE_ID = "local";

export function isMobileRuntimeMode(
  value: string | null,
): value is MobileRuntimeMode {
  return (
    value !== null &&
    (MOBILE_RUNTIME_MODES as readonly string[]).includes(value)
  );
}

export function getStoredRuntimeMode(): MobileRuntimeMode | null {
  if (typeof window === "undefined") return null;
  const value = window.localStorage.getItem(RUNTIME_MODE_KEY);
  return isMobileRuntimeMode(value) ? value : null;
}

export async function getPersistedRuntimeMode(): Promise<MobileRuntimeMode | null> {
  if (typeof window === "undefined") return null;
  if (Capacitor.isNativePlatform()) {
    const { value } = await Preferences.get({ key: RUNTIME_MODE_KEY });
    return isMobileRuntimeMode(value) ? value : null;
  }
  return getStoredRuntimeMode();
}

export function setStoredRuntimeMode(mode: MobileRuntimeMode): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RUNTIME_MODE_KEY, mode);
}

export async function setPersistedRuntimeMode(mode: MobileRuntimeMode): Promise<void> {
  if (typeof window === "undefined") return;
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({ key: RUNTIME_MODE_KEY, value: mode });
  }
  setStoredRuntimeMode(mode);
}

export async function getStandaloneProfile(): Promise<StandaloneProfileRecord | null> {
  if (typeof window === "undefined") return null;
  if (isNativeStandaloneStorageAvailable()) {
    const rows = await nativeQuery<{
      id: string;
      display_name: string | null;
      default_currency: string;
      created_at: string;
      updated_at: string;
      version: number;
    }>("SELECT * FROM local_profile WHERE id = ?", [STANDALONE_PROFILE_ID]);
    const row = rows[0];
    return row
      ? {
          id: row.id,
          displayName: row.display_name,
          defaultCurrency: row.default_currency,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          version: row.version,
        }
      : null;
  }
  const db = await getStandaloneDb();
  return (await db.get("profile", STANDALONE_PROFILE_ID)) ?? null;
}

export async function ensureStandaloneProfile(
  input: { displayName?: string | null; defaultCurrency?: string } = {},
): Promise<StandaloneProfileRecord> {
  if (typeof window === "undefined") {
    throw new Error(
      "Standalone profile is only available in the browser runtime.",
    );
  }

  if (isNativeStandaloneStorageAvailable()) {
    const existing = await getStandaloneProfile();
    const timestamp = nowIso();
    if (existing) {
      await nativeRun(
        "UPDATE local_profile SET display_name = ?, default_currency = ?, updated_at = ?, version = version + 1 WHERE id = ?",
        [
          input.displayName ?? existing.displayName,
          input.defaultCurrency ?? existing.defaultCurrency,
          timestamp,
          STANDALONE_PROFILE_ID,
        ],
      );
    } else {
      await nativeRun(
        "INSERT INTO local_profile (id, display_name, default_currency, created_at, updated_at, version) VALUES (?, ?, ?, ?, ?, 1)",
        [
          STANDALONE_PROFILE_ID,
          input.displayName ?? null,
          input.defaultCurrency ?? "AUD",
          timestamp,
          timestamp,
        ],
      );
    }
    await setPersistedRuntimeMode("standalone");
    return (await getStandaloneProfile()) as StandaloneProfileRecord;
  }

  const db = await getStandaloneDb();
  const existing = await db.get("profile", STANDALONE_PROFILE_ID);
  const timestamp = nowIso();

  if (existing) {
    const updated: StandaloneProfileRecord = {
      ...existing,
      displayName: input.displayName ?? existing.displayName,
      defaultCurrency: input.defaultCurrency ?? existing.defaultCurrency,
      updatedAt: timestamp,
      version: existing.version + 1,
    };
    await db.put("profile", updated);
    await setPersistedRuntimeMode("standalone");
    return updated;
  }

  const created: StandaloneProfileRecord = {
    id: STANDALONE_PROFILE_ID,
    displayName: input.displayName ?? null,
    defaultCurrency: input.defaultCurrency ?? "AUD",
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
  };
  await db.add("profile", created);
  await setPersistedRuntimeMode("standalone");
  return created;
}

export function createLocalRecordId(prefix: string): string {
  return createStandaloneId(prefix);
}
