import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// render.yaml backs README's "Deploy to Render" button (#477). It was checked
// against Render's JSON schema (https://render.com/schema/render.yaml.json)
// when written; these tests keep it in step with the Docker image it runs,
// so a change to the image's paths or the health route can't silently
// strand households deployed from the button.

const repoRoot = path.resolve(__dirname, "../..");
const blueprint = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
const compose = readFileSync(path.join(repoRoot, "docker-compose.yml"), "utf8");

// The envVars entry for `key`: its own line plus the next one.
function envEntry(key: string): string {
  const lines = blueprint.split("\n");
  const index = lines.findIndex((line) => line.trim() === `- key: ${key}`);
  expect(index, `${key} is declared in render.yaml`).toBeGreaterThan(-1);
  return lines.slice(index, index + 2).join("\n");
}

describe("render.yaml Blueprint", () => {
  it("mounts its disk where docker-compose.yml mounts the data directory", () => {
    expect(compose).toContain("./data:/app/data");
    expect(blueprint).toMatch(/^\s+mountPath: \/app\/data$/m);
  });

  it("keeps the database and uploads on that disk", () => {
    expect(envEntry("DATABASE_URL")).toContain("value: file:./data/app.db");
    expect(envEntry("UPLOADS_DIR")).toContain("value: ./data/uploads");
  });

  it("uses a paid single instance, since a disk can't attach to free or scale out", () => {
    expect(blueprint).not.toMatch(/^\s+plan: free$/m);
    expect(blueprint).toMatch(/^\s+numInstances: 1$/m);
  });

  it("health-checks a route that exists", () => {
    expect(blueprint).toMatch(/^\s+healthCheckPath: \/api\/health$/m);
    expect(existsSync(path.join(repoRoot, "src/app/api/health/route.ts"))).toBe(true);
  });

  it("generates every secret instead of shipping a value", () => {
    for (const key of ["AUTH_SECRET", "ENCRYPTION_KEY", "SETUP_TOKEN"]) {
      expect(envEntry(key)).toContain("generateValue: true");
    }
  });

  it("leaves APP_URL unset, so Hearth falls back to RENDER_EXTERNAL_URL", () => {
    expect(blueprint).not.toMatch(/^\s+- key: APP_URL$/m);
  });

  it("prompts for the household timezone", () => {
    expect(envEntry("TZ")).toContain("sync: false");
  });

  it("serves on the port and interface the image listens on", () => {
    expect(envEntry("PORT")).toContain('value: "3000"');
    expect(envEntry("HOSTNAME")).toContain("value: 0.0.0.0");
  });
});
