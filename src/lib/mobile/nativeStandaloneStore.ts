import { Capacitor } from "@capacitor/core";
import {
  CapacitorSQLite,
  SQLiteConnection,
  type capSQLiteSet,
  type SQLiteDBConnection,
} from "@capacitor-community/sqlite";
import { STANDALONE_SCHEMA_SQL, STANDALONE_SCHEMA_VERSION } from "@/lib/mobile/standaloneSchema";

const DB_NAME = "hearth_standalone";
const ENCRYPTED_MODE = "secret";
const ENCRYPT_EXISTING_MODE = "encryption";

let connectionPromise: Promise<SQLiteDBConnection> | null = null;

export function isNativeStandaloneStorageAvailable(): boolean {
  return Capacitor.isNativePlatform();
}

export async function getNativeStandaloneDb(): Promise<SQLiteDBConnection> {
  if (!isNativeStandaloneStorageAvailable()) {
    throw new Error("Native standalone SQLite storage is only available on iOS and Android.");
  }

  connectionPromise ??= openNativeConnection();
  return connectionPromise;
}

async function openNativeConnection(): Promise<SQLiteDBConnection> {
  const sqlite = new SQLiteConnection(CapacitorSQLite);
  await sqlite.checkConnectionsConsistency().catch(() => undefined);
  await ensureEncryptionSecret(sqlite);

  const existing = await sqlite.isConnection(DB_NAME, false).catch(() => ({ result: false }));
  const mode = existing.result ? ENCRYPTED_MODE : await connectionModeForDatabase(sqlite);
  const db = existing.result
    ? await sqlite.retrieveConnection(DB_NAME, false)
    : await sqlite.createConnection(DB_NAME, true, mode, STANDALONE_SCHEMA_VERSION, false);

  await db.open();
  await db.execute(STANDALONE_SCHEMA_SQL.join(";\n"), true);
  return db;
}

async function ensureEncryptionSecret(sqlite: SQLiteConnection): Promise<void> {
  const stored = await sqlite.isSecretStored().catch(() => ({ result: false }));
  if (stored.result) return;
  await sqlite.setEncryptionSecret(generatePassphrase());
}

async function connectionModeForDatabase(sqlite: SQLiteConnection): Promise<string> {
  const exists = await sqlite.isDatabase(DB_NAME).catch(() => ({ result: false }));
  if (!exists.result) return ENCRYPTED_MODE;

  const encrypted = await sqlite.isDatabaseEncrypted(DB_NAME).catch(() => ({ result: false }));
  return encrypted.result ? ENCRYPTED_MODE : ENCRYPT_EXISTING_MODE;
}

function generatePassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function nativeQuery<T extends Record<string, unknown>>(
  statement: string,
  values: unknown[] = [],
): Promise<T[]> {
  const db = await getNativeStandaloneDb();
  const result = await db.query(statement, values);
  return ((result.values ?? []) as T[]).filter((row) => Object.keys(row).length > 0);
}

export async function nativeRun(statement: string, values: unknown[] = []): Promise<void> {
  const db = await getNativeStandaloneDb();
  await db.run(statement, values, true);
}

export async function nativeRunSet(set: capSQLiteSet[]): Promise<void> {
  const db = await getNativeStandaloneDb();
  await db.executeSet(set, true);
}

export async function nativeExecute(statement: string): Promise<void> {
  const db = await getNativeStandaloneDb();
  await db.execute(statement, true);
}
