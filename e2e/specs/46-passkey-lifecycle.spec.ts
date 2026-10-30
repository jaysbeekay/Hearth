import { generateKeyPairSync, randomBytes, randomUUID } from "crypto";
import { test, expect, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { createClient, type Client } from "@libsql/client";
import { ADMIN_AUTH_FILE, ADMIN_EMAIL, BASE_URL, DATABASE_URL } from "../env";

// #376 — @simplewebauthn 9 → 14. A Chromium virtual authenticator drives the
// whole passkey lifecycle through the real UI (register, sign in, remove), and
// a credential seeded straight into the database in the 9.x row format proves
// passkeys registered before the upgrade still sign in after it.
//
// Every row this spec writes carries NICKNAME_PREFIX and is deleted in
// afterAll, so it leaves no passkeys behind for the specs that follow.

test.use({ storageState: ADMIN_AUTH_FILE });

const stamp = Date.now();
const NICKNAME_PREFIX = "E2E 46 passkey";
// The app's RP ID is APP_URL's hostname, and the suite sets APP_URL to BASE_URL.
const RP_ID = new URL(BASE_URL).hostname;

let db: Client;

test.beforeAll(async () => {
  db = createClient({ url: DATABASE_URL });
  await db.execute("PRAGMA busy_timeout = 5000");
});

test.afterAll(async () => {
  await db.execute({
    sql: "DELETE FROM passkey_credentials WHERE nickname LIKE ?",
    args: [`${NICKNAME_PREFIX}%`],
  });
  db.close();
});

async function addVirtualAuthenticator(page: Page, context: BrowserContext) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

async function credentialRow(nickname: string) {
  const { rows } = await db.execute({
    sql: `SELECT credentialId, length(publicKey) AS keyLength, counter, transports, lastUsedAt
          FROM passkey_credentials WHERE nickname = ?`,
    args: [nickname],
  });
  return rows[0];
}

async function adminUserId(): Promise<string> {
  const { rows } = await db.execute({
    sql: "SELECT id FROM users WHERE email = ?",
    args: [ADMIN_EMAIL],
  });
  return String(rows[0].id);
}

/** Insert a passkey row directly, in the 9.x row format. */
async function insertPasskeyRow(row: {
  userId: string;
  credentialId: string;
  publicKey: Buffer;
  counter: number;
  nickname: string;
}) {
  await db.execute({
    sql: `INSERT INTO passkey_credentials (id, userId, credentialId, publicKey, counter, transports, nickname, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      row.userId,
      row.credentialId,
      row.publicKey,
      row.counter,
      JSON.stringify(["internal"]),
      row.nickname,
      new Date("2026-07-03T00:00:00.000Z").toISOString(),
    ],
  });
}

async function signInWithPasskey(page: Page, context: BrowserContext) {
  await context.clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with passkey" }).click();
}

async function onlyCredentialId(cdp: CDPSession, authenticatorId: string): Promise<string> {
  const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
  expect(credentials).toHaveLength(1);
  // CDP reports binary fields as standard base64; Hearth stores base64url.
  return Buffer.from(credentials[0].credentialId, "base64").toString("base64url");
}

test("a passkey can be registered, used to sign in, and removed", async ({ page, context }) => {
  const nickname = `${NICKNAME_PREFIX} lifecycle ${stamp}`;
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page, context);

  // Register through Settings → Passkeys.
  await page.goto("/settings/passkeys");
  await page.locator("#passkey-nickname").fill(nickname);
  await page.getByRole("button", { name: "Add passkey" }).click();
  await expect(page.getByText(nickname)).toBeVisible();

  // Stored in the same format 9.x wrote: the authenticator's credential id
  // as base64url, the COSE public key bytes, and the transports.
  const credentialId = await onlyCredentialId(cdp, authenticatorId);
  const registered = await credentialRow(nickname);
  expect(registered.credentialId).toBe(credentialId);
  expect(Number(registered.keyLength)).toBeGreaterThan(0);
  expect(JSON.parse(String(registered.transports))).toContain("internal");
  expect(registered.lastUsedAt).toBeNull();

  // Sign in with it.
  await signInWithPasskey(page, context);
  await expect(page).toHaveURL(/\/dashboard/);
  const used = await credentialRow(nickname);
  expect(used.lastUsedAt).not.toBeNull();
  expect(Number(used.counter)).toBeGreaterThan(Number(registered.counter));

  // A decoy passkey that stays registered, so the login page keeps offering
  // passkey sign-in after the removal below (#344 hides it when there are
  // none) and the refusal is always exercised, even when this spec runs alone.
  await insertPasskeyRow({
    userId: await adminUserId(),
    credentialId: randomBytes(16).toString("base64url"),
    publicKey: randomBytes(77),
    counter: 0,
    nickname: `${NICKNAME_PREFIX} decoy ${stamp}`,
  });

  // Remove it from Settings → Passkeys.
  await page.goto("/settings/passkeys");
  await page.getByRole("button", { name: `Remove passkey ${nickname}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove passkey" }).click();
  await expect(page.getByText(nickname)).toHaveCount(0);
  expect(await credentialRow(nickname)).toBeUndefined();

  // The authenticator still holds the credential, but the server no longer
  // knows it, so sign-in is refused.
  await signInWithPasskey(page, context);
  await expect(page.getByText(/Passkey sign-in failed/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("a passkey stored in the 9.x row format still signs in", async ({ page, context }) => {
  const nickname = `${NICKNAME_PREFIX} pre-upgrade ${stamp}`;
  const { cdp, authenticatorId } = await addVirtualAuthenticator(page, context);

  const userId = await adminUserId();

  // A credential as an authenticator would hold it from a 9.x registration:
  // the user handle 9.x produced was the UTF-8 bytes of the user id.
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const rawId = randomBytes(16);
  const startCount = 7;
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId,
    credential: {
      credentialId: rawId.toString("base64"),
      isResidentCredential: true,
      rpId: RP_ID,
      privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      userHandle: Buffer.from(userId, "utf8").toString("base64"),
      signCount: startCount,
    },
  });

  // The row exactly as 9.x's register/verify route stored it: base64url
  // credential id (Buffer#toString("base64url")), COSE EC2 public key bytes.
  const jwk = publicKey.export({ format: "jwk" });
  const cosePublicKey = Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from([0x22, 0x58, 0x20]),
    Buffer.from(jwk.y!, "base64url"),
  ]);
  await insertPasskeyRow({
    userId,
    credentialId: rawId.toString("base64url"),
    publicKey: cosePublicKey,
    counter: startCount,
    nickname,
  });

  await signInWithPasskey(page, context);
  await expect(page).toHaveURL(/\/dashboard/);

  const row = await credentialRow(nickname);
  expect(row.lastUsedAt).not.toBeNull();
  expect(Number(row.counter)).toBeGreaterThan(startCount);
});
