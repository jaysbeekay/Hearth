// Seeds the demo household into an empty, migrated database (#553).
//
//   DATABASE_URL=file:/tmp/demo/app.db UPLOADS_DIR=/tmp/demo/uploads \
//     npx tsx scripts/demo/seed-cli.ts
//
// DEMO_MEMBER_PASSWORD sets the visitors' login (default "hearth-demo"; it is
// published on purpose). DEMO_ADMIN_PASSWORD sets the maintainer's login; if
// it is unset, a random one is used and never printed, which leaves the admin
// account unusable. It refuses a database that already has users, so it can't
// seed over a real household, and it refuses the live install's default
// paths (./data, /app/data, /data). Needs Node 22.15 or later.
import { randomBytes } from "node:crypto";
import * as nodeModule from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { touchesLive } from "../itemStageGuard";

// Never the live install: demo users with a published password on a fresh
// real instance would close /setup and leave a known login. DATABASE_URL and
// UPLOADS_DIR must be set explicitly, and not to the documented defaults.
const LIVE_DEFAULTS = ["./data", "/app/data", "/data"].map((p) => path.resolve(p));
const dbPath = process.env.DATABASE_URL?.startsWith("file:")
  ? process.env.DATABASE_URL.slice("file:".length).split("?")[0]
  : undefined;
const uploadsDir = process.env.UPLOADS_DIR;
if (!dbPath || !uploadsDir) {
  console.error("[demo-seed] Set DATABASE_URL (file:...) and UPLOADS_DIR to a scratch database and folder.");
  process.exit(1);
}
const live = [dbPath, uploadsDir].filter((p) => touchesLive(path.resolve(p), LIVE_DEFAULTS));
if (live.length > 0) {
  console.error(`[demo-seed] Refusing to seed the live install (${live.join(", ")}). Use a scratch path.`);
  process.exit(1);
}

// module.registerHooks arrived in Node 22.15; say so rather than failing
// with "registerHooks is not a function" on an older 22.x.
const { registerHooks } = nodeModule as Partial<typeof nodeModule>;
if (typeof registerHooks !== "function") {
  console.error(`[demo-seed] Needs Node 22.15 or later (module.registerHooks); this is ${process.version}.`);
  process.exit(1);
}

// The record commands call next/cache's revalidatePath, which throws outside
// a Next request. Swap in a no-op before anything imports it.
const stub = pathToFileURL(path.join(__dirname, "next-cache-stub.cjs")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

async function main() {
  const { seedDemo, DemoSeedRefusedError, DEMO_MEMBER_EMAIL } = await import("./seed");
  const memberPassword = process.env.DEMO_MEMBER_PASSWORD || "hearth-demo";
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD || randomBytes(24).toString("base64url");
  if (memberPassword.length < 8 || adminPassword.length < 8) {
    throw new Error("Demo passwords must be at least 8 characters.");
  }
  try {
    await seedDemo({ memberPassword, adminPassword });
  } catch (error) {
    if (error instanceof DemoSeedRefusedError) {
      console.error(`[demo-seed] ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
  console.log(`[demo-seed] seeded the demo household. Visitors sign in as ${DEMO_MEMBER_EMAIL}.`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
