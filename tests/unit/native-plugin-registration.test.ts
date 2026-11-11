import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The mobile shell's own native plugins live in the app targets, not in npm
// packages, so Capacitor doesn't register them: MainViewController.swift and
// MainActivity.java must. A plugin that is left out still compiles, and the
// shell treats a missing plugin as "not available", so the feature just
// disappears. This catches that, including a merge that keeps only one side
// of two plugin registrations.

const root = process.cwd();
const iosDir = path.join(root, "ios/App/App");
const androidDir = path.join(root, "android/app/src/main/java/com/hearthapp/app");

function read(file: string) {
  return readFileSync(file, "utf8");
}

function iosPlugins() {
  return readdirSync(iosDir)
    .filter((file) => file.endsWith(".swift"))
    .flatMap((file) => [...read(path.join(iosDir, file)).matchAll(/class\s+(\w+)\s*:\s*CAPPlugin\b/g)].map((match) => ({ file, name: match[1] })));
}

function androidPlugins() {
  return readdirSync(androidDir)
    .filter((file) => file.endsWith(".java"))
    .flatMap((file) => {
      const source = read(path.join(androidDir, file));
      if (!source.includes("@CapacitorPlugin")) return [];
      return [...source.matchAll(/class\s+(\w+)\s+extends\s+Plugin\b/g)].map((match) => ({ file, name: match[1] }));
    });
}

describe("native plugin registration", () => {
  it("finds the app's own plugins", () => {
    expect(iosPlugins().map((plugin) => plugin.name)).toContain("ServerConfigPlugin");
    expect(androidPlugins().map((plugin) => plugin.name)).toContain("ServerConfigPlugin");
  });

  it("registers every iOS plugin in MainViewController and builds its file", () => {
    const controller = read(path.join(iosDir, "MainViewController.swift"));
    const project = read(path.join(root, "ios/App/App.xcodeproj/project.pbxproj"));
    for (const { file, name } of iosPlugins()) {
      expect(controller, `${name} is not registered`).toContain(`registerPluginInstance(${name}())`);
      expect(project, `${file} is not in the App target's sources`).toContain(`/* ${file} in Sources */,`);
    }
  });

  it("registers every Android plugin in MainActivity", () => {
    const activity = read(path.join(androidDir, "MainActivity.java"));
    for (const { name } of androidPlugins()) {
      expect(activity, `${name} is not registered`).toContain(`registerPlugin(${name}.class)`);
    }
  });
});
