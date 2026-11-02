import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasAnyValue } from "@/components/FormSection";
import { guessContractCategory } from "@/lib/contractCategoryGuess";
import { contractSchema } from "@/lib/validation/contract";

// #361 — shorter forms: optional fields fold away, Category is really required.

describe("hasAnyValue", () => {
  it("opens a section for any stored value, and not for blanks", () => {
    expect(hasAnyValue([undefined, null, "", "  ", false])).toBe(false);
    expect(hasAnyValue(["", "Note"])).toBe(true);
    expect(hasAnyValue([0])).toBe(true);
    expect(hasAnyValue([new Date()])).toBe(true);
    expect(hasAnyValue([true])).toBe(true);
  });
});

describe("guessContractCategory", () => {
  it("prefers the specific insurance over a bare keyword", () => {
    expect(guessContractCategory("Allianz", "Car insurance policy")).toBe("CAR_INSURANCE");
    expect(guessContractCategory("Budget Direct", "Home and contents insurance")).toBe("HOME_INSURANCE");
    expect(guessContractCategory("Strata Plan 1234", "Building cover")).toBe("STRATA_INSURANCE");
  });

  it("recognises the common household contracts", () => {
    expect(guessContractCategory("Acme Realty", "Residential tenancy agreement")).toBe("RENTAL");
    expect(guessContractCategory("Telstra", "Mobile plan")).toBe("TELECOM");
    expect(guessContractCategory("AGL", "Electricity")).toBe("UTILITY");
    expect(guessContractCategory("Netflix", "")).toBe("SUBSCRIPTION");
    expect(guessContractCategory("Big Bank", "Home loan")).toBe("LOAN");
  });

  it("leaves the choice to the person when nothing matches", () => {
    expect(guessContractCategory("Acme Pty Ltd", "Agreement")).toBeUndefined();
    expect(guessContractCategory(undefined, "")).toBeUndefined();
  });
});

describe("contract Category", () => {
  it("is rejected when left on Choose a category", () => {
    const result = contractSchema.safeParse({
      title: "Lease",
      provider: "Acme",
      category: "",
      renewalType: "MANUAL_RENEWAL",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.find((issue) => issue.path[0] === "category")?.message).toBe(
      "Choose a category",
    );
  });
});

describe("form sections", () => {
  const root = path.join(__dirname, "..", "..");
  const read = (name: string) => readFileSync(path.join(root, "src", "components", `${name}.tsx`), "utf8");

  it.each(["ContractForm", "ProductForm", "VehicleForm"])("%s folds optional fields and Reminders", (form) => {
    const source = read(form);
    expect(source).toContain('title="More details"');
    expect(source).toContain('title="Reminders"');
  });

  it("the contract form no longer defaults Category to Other", () => {
    const source = read("ContractForm");
    expect(source).not.toMatch(/category \?\? "OTHER"/);
    expect(source).toContain("Choose a category");
  });

  it("extraction opens the section a filled field sits in", () => {
    const source = readFileSync(path.join(root, "src", "lib", "autoFillHighlight.ts"), "utf8");
    expect(source).toMatch(/closest\("details"\)/);
  });
});
