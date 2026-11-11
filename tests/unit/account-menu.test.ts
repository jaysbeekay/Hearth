import { describe, expect, it } from "vitest";
import { initials, versionLabel } from "@/lib/account";

describe("account menu version", () => {
  it("shows the version and short commit, or just the version", () => {
    expect(versionLabel("0.20.1", "605d002")).toBe("v0.20.1 (605d002)");
    expect(versionLabel("0.20.1", "")).toBe("v0.20.1");
    expect(versionLabel("", "605d002")).toBe("");
  });
});

describe("account menu initials", () => {
  it("takes the first and last name's first letters", () => {
    expect(initials("Jonathan Kaiser", "j@example.com")).toBe("JK");
    expect(initials("  ana maria  de souza ", "a@example.com")).toBe("AS");
  });

  it("uses one letter for a one-word name", () => {
    expect(initials("Cher", "c@example.com")).toBe("C");
  });

  it("falls back to the email, then a question mark", () => {
    expect(initials("", "pat@example.com")).toBe("P");
    expect(initials("   ", "")).toBe("?");
  });
});
