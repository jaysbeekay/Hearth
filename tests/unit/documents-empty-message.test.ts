import { describe, expect, it } from "vitest";
import { documentsEmptyMessage } from "@/lib/documents/emptyMessage";

describe("documentsEmptyMessage", () => {
  it("names the selected type", () => {
    expect(documentsEmptyMessage("Vehicles", false)).toBe("No vehicles documents yet.");
    expect(documentsEmptyMessage("Travel", true)).toBe("No travel documents yet.");
  });

  it("never says 'undefined' when no type is selected", () => {
    expect(documentsEmptyMessage(undefined, false)).toBe("No filed documents yet.");
    expect(documentsEmptyMessage(undefined, true)).toBe("No documents yet.");
  });
});
