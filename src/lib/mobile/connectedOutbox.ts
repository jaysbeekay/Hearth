import { openDB, type DBSchema } from "idb";
import type {
  MobileAttachmentInput,
  MobileMutationOptions,
  MobileRepositories,
} from "@/lib/mobile/repositories";
import type {
  MobileContractInput,
  MobileProductInput,
  MobileRecordId,
  MobileVehicleInput,
  MobileVehicleItemInput,
} from "@/lib/mobile/dtos";

const OUTBOX_DB_NAME = "hearth-mobile-connected-outbox";
const OUTBOX_DB_VERSION = 1;

export type MobileOutboxStatus = "pending" | "syncing" | "done" | "failed";

export type MobileOutboxMutation =
  | {
      entity: "contract";
      operation: "create" | "update" | "delete";
      entityId?: MobileRecordId;
      payload?: MobileContractInput;
      options?: MobileMutationOptions;
    }
  | {
      entity: "product";
      operation: "create" | "update" | "delete";
      entityId?: MobileRecordId;
      payload?: MobileProductInput;
      options?: MobileMutationOptions;
    }
  | {
      entity: "vehicle";
      operation: "create" | "update" | "delete";
      entityId?: MobileRecordId;
      payload?: MobileVehicleInput;
      options?: MobileMutationOptions;
    }
  | {
      entity: "vehicleItem";
      operation: "create" | "update" | "delete";
      parentId: MobileRecordId;
      entityId?: MobileRecordId;
      payload?: MobileVehicleItemInput;
      options?: MobileMutationOptions;
    }
  | {
      entity: "document";
      operation: "attach" | "delete";
      entityId?: MobileRecordId;
      payload?: MobileAttachmentInput;
      options?: MobileMutationOptions;
    };

export interface MobileOutboxEntry {
  id: string;
  mutation: MobileOutboxMutation;
  status: MobileOutboxStatus;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}

interface MobileOutboxSchema extends DBSchema {
  mutations: {
    key: string;
    value: MobileOutboxEntry;
    indexes: {
      "by-status": MobileOutboxStatus;
      "by-created": string;
    };
  };
}

async function getOutboxDb() {
  return openDB<MobileOutboxSchema>(OUTBOX_DB_NAME, OUTBOX_DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore("mutations", { keyPath: "id" });
      store.createIndex("by-status", "status");
      store.createIndex("by-created", "createdAt");
    },
  });
}

function nowIso() {
  return new Date().toISOString();
}

export async function enqueueConnectedMutation(
  mutation: MobileOutboxMutation,
): Promise<MobileOutboxEntry> {
  const db = await getOutboxDb();
  const timestamp = nowIso();
  const entry: MobileOutboxEntry = {
    id: crypto.randomUUID(),
    mutation,
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
    error: null,
  };
  await db.add("mutations", entry);
  return entry;
}

export async function listConnectedOutbox(): Promise<MobileOutboxEntry[]> {
  const db = await getOutboxDb();
  return (await db.getAllFromIndex("mutations", "by-created")).filter(
    (entry) => entry.status === "pending" || entry.status === "failed",
  );
}

export async function discardConnectedOutboxEntry(id: string): Promise<void> {
  const db = await getOutboxDb();
  await db.delete("mutations", id);
}

async function updateOutboxEntry(
  entry: MobileOutboxEntry,
  status: MobileOutboxStatus,
  error: string | null = null,
) {
  const db = await getOutboxDb();
  await db.put("mutations", {
    ...entry,
    status,
    error,
    updatedAt: nowIso(),
  });
}

export async function drainConnectedOutbox(
  repositories: MobileRepositories,
): Promise<{
  attempted: number;
  succeeded: number;
  failed: number;
}> {
  const entries = await listConnectedOutbox();
  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    await updateOutboxEntry(entry, "syncing");
    try {
      await applyMutation(repositories, entry.mutation);
      await updateOutboxEntry(entry, "done");
      succeeded += 1;
    } catch (error) {
      await updateOutboxEntry(
        entry,
        "failed",
        error instanceof Error ? error.message : "Unknown sync error",
      );
      failed += 1;
    }
  }

  return { attempted: entries.length, succeeded, failed };
}

async function applyMutation(
  repositories: MobileRepositories,
  mutation: MobileOutboxMutation,
): Promise<void> {
  if (mutation.entity === "contract") {
    if (mutation.operation === "create" && mutation.payload) {
      await repositories.contracts.create(mutation.payload, mutation.options);
      return;
    }
    if (
      mutation.operation === "update" &&
      mutation.entityId &&
      mutation.payload
    ) {
      await repositories.contracts.update(
        mutation.entityId,
        mutation.payload,
        mutation.options,
      );
      return;
    }
    if (mutation.operation === "delete" && mutation.entityId) {
      await repositories.contracts.remove(mutation.entityId, mutation.options);
      return;
    }
  }

  if (mutation.entity === "product") {
    if (mutation.operation === "create" && mutation.payload) {
      await repositories.products.create(mutation.payload, mutation.options);
      return;
    }
    if (
      mutation.operation === "update" &&
      mutation.entityId &&
      mutation.payload
    ) {
      await repositories.products.update(
        mutation.entityId,
        mutation.payload,
        mutation.options,
      );
      return;
    }
    if (mutation.operation === "delete" && mutation.entityId) {
      await repositories.products.remove(mutation.entityId, mutation.options);
      return;
    }
  }

  if (mutation.entity === "vehicle" && repositories.vehicles) {
    if (mutation.operation === "create" && mutation.payload) {
      await repositories.vehicles.create(mutation.payload, mutation.options);
      return;
    }
    if (
      mutation.operation === "update" &&
      mutation.entityId &&
      mutation.payload
    ) {
      await repositories.vehicles.update(
        mutation.entityId,
        mutation.payload,
        mutation.options,
      );
      return;
    }
    if (mutation.operation === "delete" && mutation.entityId) {
      await repositories.vehicles.remove(mutation.entityId, mutation.options);
      return;
    }
  }

  if (mutation.entity === "vehicleItem" && repositories.vehicles) {
    if (mutation.operation === "create" && mutation.payload) {
      await repositories.vehicles.createItem(
        mutation.parentId,
        mutation.payload,
        mutation.options,
      );
      return;
    }
    if (
      mutation.operation === "update" &&
      mutation.entityId &&
      mutation.payload
    ) {
      await repositories.vehicles.updateItem(
        mutation.parentId,
        mutation.entityId,
        mutation.payload,
        mutation.options,
      );
      return;
    }
    if (mutation.operation === "delete" && mutation.entityId) {
      await repositories.vehicles.removeItem(
        mutation.parentId,
        mutation.entityId,
        mutation.options,
      );
      return;
    }
  }

  if (mutation.entity === "document") {
    if (mutation.operation === "attach" && mutation.payload) {
      await repositories.documents.attach(mutation.payload, mutation.options);
      return;
    }
    if (mutation.operation === "delete" && mutation.entityId) {
      await repositories.documents.remove(mutation.entityId, mutation.options);
      return;
    }
  }

  throw new Error("Unsupported queued mobile mutation.");
}
