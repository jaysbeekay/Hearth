import { describe, expect, it } from "vitest";
import { isToastShortcut, toastShortcutHint, TOAST_SHORTCUT_LABEL } from "@/lib/toastShortcut";

// #631 — Alt+T moves focus into the newest toast.
const key = (code: string, mods: Partial<Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>> = {}) => ({
  code,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe("isToastShortcut", () => {
  it("matches Alt+T", () => {
    expect(isToastShortcut(key("KeyT", { altKey: true }))).toBe(true);
  });

  it("matches by physical key, so Option+T on a Mac counts whatever character it types", () => {
    // event.key would be "†" on a Mac; only event.code is read.
    expect(isToastShortcut({ ...key("KeyT", { altKey: true }), key: "†" } as ReturnType<typeof key>)).toBe(true);
  });

  it("ignores T without Alt", () => {
    expect(isToastShortcut(key("KeyT"))).toBe(false);
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
  ])("ignores Alt+T with %s held too", (_name, mods) => {
    expect(isToastShortcut(key("KeyT", { altKey: true, ...mods }))).toBe(false);
  });

  it("ignores Alt with another key", () => {
    expect(isToastShortcut(key("KeyR", { altKey: true }))).toBe(false);
  });
});

describe("toastShortcutHint", () => {
  it("names the shortcut and the action it reaches", () => {
    expect(toastShortcutHint("Undo")).toBe("Press Alt+T to reach Undo.");
    expect(TOAST_SHORTCUT_LABEL).toBe("Alt+T");
  });
});
