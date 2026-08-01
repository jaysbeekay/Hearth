import type { ModuleKey } from "@/lib/modules/registry";

export const MOBILE_RUNTIME_MODES = ["standalone", "connected"] as const;

export type MobileRuntimeMode = (typeof MOBILE_RUNTIME_MODES)[number];

export type MobileAvailability =
  | "available"
  | "partial"
  | "server-required"
  | "not-available";

export type MobileSharingScope =
  | "device-local"
  | "household-wide"
  | "user-private"
  | "system";

export interface MobileCapability {
  key: string;
  label: string;
  standalone: MobileAvailability;
  connected: MobileAvailability;
  sharingScope: MobileSharingScope;
  serverFeature?: string;
  notes: string;
}

export const MOBILE_CAPABILITIES = [
  {
    key: "contracts",
    label: "Contracts",
    standalone: "available",
    connected: "available",
    sharingScope: "household-wide",
    notes:
      "Always-on domain. Standalone stores one local household; connected uses server household sharing.",
  },
  {
    key: "products",
    label: "Products and warranties",
    standalone: "available",
    connected: "available",
    sharingScope: "household-wide",
    notes: "Always-on domain with attachment support in both modes.",
  },
  {
    key: "documents",
    label: "Documents and attachments",
    standalone: "available",
    connected: "available",
    sharingScope: "household-wide",
    notes:
      "Standalone uses native protected storage. Connected uploads to and downloads from the server.",
  },
  {
    key: "documentExtraction",
    label: "Document extraction",
    standalone: "partial",
    connected: "available",
    sharingScope: "system",
    serverFeature: "text-extraction-ai",
    notes:
      "Standalone can support local heuristics. Cloud or server AI extraction requires connected mode.",
  },
  {
    key: "moduleSettings",
    label: "Module settings",
    standalone: "available",
    connected: "available",
    sharingScope: "system",
    notes:
      "Module toggles affect navigation and validation. Disabled modules retain data.",
  },
  {
    key: "householdMembers",
    label: "Household members",
    standalone: "not-available",
    connected: "available",
    sharingScope: "household-wide",
    serverFeature: "household-users",
    notes:
      "Standalone is explicitly single-device and has no household invitations.",
  },
  {
    key: "reminders",
    label: "Reminders",
    standalone: "partial",
    connected: "available",
    sharingScope: "system",
    serverFeature: "smtp-ntfy-cron",
    notes:
      "Standalone can use local notifications only. Email, ntfy, and cron are connected/server features.",
  },
  {
    key: "aiAssistant",
    label: "AI assistant",
    standalone: "not-available",
    connected: "available",
    sharingScope: "household-wide",
    serverFeature: "ai-providers",
    notes:
      "Assistant depends on server-held provider configuration and server-side read tools.",
  },
  {
    key: "mcp",
    label: "MCP",
    standalone: "not-available",
    connected: "available",
    sharingScope: "household-wide",
    serverFeature: "mcp",
    notes: "No local MCP server is shipped inside the mobile app.",
  },
  {
    key: "backups",
    label: "Backups",
    standalone: "partial",
    connected: "available",
    sharingScope: "system",
    serverFeature: "backup-jobs",
    notes:
      "Standalone supports local export/restore. S3/SFTP scheduled backups stay server-only.",
  },
  {
    key: "webhooks",
    label: "Webhooks",
    standalone: "not-available",
    connected: "available",
    sharingScope: "system",
    serverFeature: "webhooks",
    notes: "Webhook delivery is a server capability.",
  },
  {
    key: "passkeys",
    label: "Passkeys",
    standalone: "partial",
    connected: "available",
    sharingScope: "user-private",
    serverFeature: "webauthn",
    notes:
      "Standalone should use device lock or biometrics. Connected can retain server WebAuthn.",
  },
  {
    key: "totp",
    label: "Two-factor authentication",
    standalone: "not-available",
    connected: "available",
    sharingScope: "user-private",
    serverFeature: "totp",
    notes: "Standalone has no remote account to protect with TOTP.",
  },
  {
    key: "wealthPrices",
    label: "Live wealth prices",
    standalone: "partial",
    connected: "available",
    sharingScope: "household-wide",
    serverFeature: "wealth-price-feeds",
    notes:
      "Standalone may show manually-entered or last-imported prices. Live feeds require network capability.",
  },
  {
    key: "barcodeLookup",
    label: "Barcode lookup",
    standalone: "not-available",
    connected: "available",
    sharingScope: "system",
    serverFeature: "barcode-lookup",
    notes: "Online lookup remains a server-mediated capability.",
  },
  {
    key: "connectedOfflineQueue",
    label: "Connected offline queue",
    standalone: "not-available",
    connected: "partial",
    sharingScope: "system",
    serverFeature: "sync-api",
    notes:
      "This is a connected-mode enhancement, not the standalone storage model.",
  },
] as const satisfies readonly MobileCapability[];

export type MobileCapabilityKey = (typeof MOBILE_CAPABILITIES)[number]["key"];

export interface MobileEntityContract {
  key: string;
  label: string;
  module: ModuleKey | "CORE";
  sharingScope: MobileSharingScope;
  standalone: MobileAvailability;
  connected: MobileAvailability;
  supportsAttachments: boolean;
  supportsOfflineConnectedQueue: boolean;
}

export const MOBILE_ENTITY_CONTRACTS = [
  {
    key: "contract",
    label: "Contract",
    module: "CORE",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "product",
    label: "Product",
    module: "CORE",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "vehicle",
    label: "Vehicle",
    module: "VEHICLES",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: false,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "vehicleItem",
    label: "Vehicle item",
    module: "VEHICLES",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "trip",
    label: "Trip",
    module: "TRAVEL",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: false,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "tripSegment",
    label: "Trip segment",
    module: "TRAVEL",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "property",
    label: "Property",
    module: "HOME",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: false,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "homeItem",
    label: "Home item",
    module: "HOME",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "inventoryItem",
    label: "Inventory item",
    module: "INVENTORY",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "portfolio",
    label: "Portfolio",
    module: "WEALTH",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: false,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "holding",
    label: "Holding",
    module: "WEALTH",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: false,
    supportsOfflineConnectedQueue: true,
  },
  {
    key: "trade",
    label: "Trade",
    module: "WEALTH",
    sharingScope: "household-wide",
    standalone: "available",
    connected: "available",
    supportsAttachments: true,
    supportsOfflineConnectedQueue: true,
  },
] as const satisfies readonly MobileEntityContract[];

export function getMobileCapability(
  key: MobileCapabilityKey,
): MobileCapability {
  const capability = MOBILE_CAPABILITIES.find((item) => item.key === key);
  if (!capability) throw new Error(`Unknown mobile capability: ${key}`);
  return capability;
}

export function getCapabilityAvailability(
  key: MobileCapabilityKey,
  mode: MobileRuntimeMode,
): MobileAvailability {
  return getMobileCapability(key)[mode];
}

export function isCapabilityAvailable(
  key: MobileCapabilityKey,
  mode: MobileRuntimeMode,
): boolean {
  const availability = getCapabilityAvailability(key, mode);
  return availability === "available" || availability === "partial";
}
