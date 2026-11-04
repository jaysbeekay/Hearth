// Seeds the demo household into an empty, migrated database (#553).
//
//   DATABASE_URL=file:/tmp/demo/app.db UPLOADS_DIR=/tmp/demo/uploads \
//     npx tsx scripts/demo/seed-cli.ts
//
// DEMO_MEMBER_PASSWORD sets the visitors' login (default "hearth-demo"; it is
// published on purpose). DEMO_ADMIN_PASSWORD sets the maintainer's login; if
// it is unset, a random one is used and never printed, which leaves the admin
// account unusable. It refuses a database that already has users, so it can't
// seed over a real household. Never point it at /data.
import { randomBytes } from "node:crypto";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

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
