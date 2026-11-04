import { describe, expect, it } from "vitest";
import { extractionFieldsFromForm, extractionReviewedOnSave } from "@/lib/documents/extractionConfirmation";

function form(entries: [string, string][]) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

describe("extractionFieldsFromForm (#359)", () => {
  it("leaves the record alone when no scan happened", () => {
    expect(extractionFieldsFromForm(form([["confirmExtraction", "1"]]))).toEqual({});
  });

  it("treats Save after a scan as the review", () => {
    const fields = extractionFieldsFromForm(form([["extractionUsed", "1"], ["confirmExtraction", "1"]]));
    expect(fields.extractionPending).toBe(false);
    expect(fields.extractionConfirmedAt).toBeInstanceOf(Date);
  });

  it("keeps Needs review when Save for later review sends a 0 beside the form's 1", () => {
    expect(
      extractionFieldsFromForm(
        form([["extractionUsed", "1"], ["confirmExtraction", "1"], ["confirmExtraction", "0"]]),
      ),
    ).toEqual({ extractionPending: true, extractionConfirmedAt: null });
  });

  it("lets a 0 win in any order, and repeated 1s never outvote it", () => {
    for (const values of [["0", "1"], ["1", "1", "0"], ["0", "0"]]) {
      expect(
        extractionFieldsFromForm(form([["extractionUsed", "1"], ...values.map((v): [string, string] => ["confirmExtraction", v])])),
      ).toEqual({ extractionPending: true, extractionConfirmedAt: null });
    }
  });

  it("keeps Needs review when nothing says it was reviewed", () => {
    expect(extractionFieldsFromForm(form([["extractionUsed", "1"]]))).toEqual({
      extractionPending: true,
      extractionConfirmedAt: null,
    });
  });
});

describe("extractionReviewedOnSave (#359)", () => {
  it("confirms a row the person edited, whatever the scan found", () => {
    expect(extractionReviewedOnSave({ edited: true, source: "none", autoFilledCount: 0 })).toBe(true);
  });

  it("confirms an untouched row the scan read confidently", () => {
    expect(extractionReviewedOnSave({ edited: false, source: "heuristic", autoFilledCount: 2 })).toBe(true);
    expect(extractionReviewedOnSave({ edited: false, source: "byok", autoFilledCount: 4 })).toBe(true);
  });

  it("leaves an untouched, weakly read row for review", () => {
    expect(extractionReviewedOnSave({ edited: false, source: "heuristic", autoFilledCount: 1 })).toBe(false);
    expect(extractionReviewedOnSave({ edited: false, source: "none", autoFilledCount: 3 })).toBe(false);
  });
});
