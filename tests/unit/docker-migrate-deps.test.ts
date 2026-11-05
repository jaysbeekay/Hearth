import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

// The Docker image runs `prisma migrate deploy` with a CLI installed from
// docker/migrate, apart from the app's own dependencies (#518). If the two
// Prisma versions drift, the container would migrate with a different CLI
// than the one the app's client and migrations were generated with.

const root = path.resolve(__dirname, "../..");
const readJson = (file: string) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

describe("docker/migrate Prisma CLI", () => {
  const rootPkg = readJson("package.json");
  const rootLock = readJson("package-lock.json");
  const migratePkg = readJson("docker/migrate/package.json");
  const migrateLock = readJson("docker/migrate/package-lock.json");
  const appPrisma: string = rootLock.packages["node_modules/prisma"].version;

  it("pins exactly the prisma version the app's lockfile resolves", () => {
    expect(migratePkg.dependencies.prisma).toBe(appPrisma);
  });

  it("has a lockfile that resolves that same version", () => {
    expect(migrateLock.packages[""].dependencies.prisma).toBe(appPrisma);
    expect(migrateLock.packages["node_modules/prisma"].version).toBe(appPrisma);
  });

  // The root overrides patch vulnerable transitive deps (Docker Scout gates
  // the image on them), and the Prisma CLI pulls in some of the same ones,
  // e.g. mysql2. Without the same overrides the image would ship the
  // unpatched versions under /opt/migrate.
  it("carries the root package.json overrides", () => {
    expect(migratePkg.overrides).toEqual(rootPkg.overrides);
  });
});
