import { describe, expect, it } from "vitest";
import {
  documentTypeLabel,
  groupDocumentVersions,
  showsThumbnail,
  type DocumentListRow,
} from "@/lib/documents/documentList";
import { documentCategoryLabel } from "@/lib/documents/categories";

// #397 — the one Document list's grouping and labels, shared by every kind.

function row(id: string, supersedesId: string | null = null, extra: Partial<DocumentListRow> = {}): DocumentListRow {
  return {
    id,
    filename: `${id}.pdf`,
    mimeType: "application/pdf",
    size: 100,
    uploadedAt: new Date("2026-10-01T00:00:00Z"),
    category: null,
    isImportant: false,
    supersedesId,
    ...extra,
  };
}

const ids = (rows: DocumentListRow[]) => rows.map((r) => r.id);

describe("groupDocumentVersions", () => {
  it("lists unrelated Documents each on their own, in the order given", () => {
    const groups = groupDocumentVersions([row("a"), row("b")]);
    expect(groups.map((g) => g.latest.id)).toEqual(["a", "b"]);
    expect(groups.every((g) => g.older.length === 0)).toBe(true);
  });

  it("puts older versions under the latest one, newest first", () => {
    // Newest upload first, as the pages order them.
    const groups = groupDocumentVersions([row("v3", "v2"), row("other"), row("v2", "v1"), row("v1")]);
    expect(groups.map((g) => g.latest.id)).toEqual(["v3", "other"]);
    expect(ids(groups[0].older)).toEqual(["v2", "v1"]);
  });

  it("ends the chain at an older version that isn't in the list (in Trash)", () => {
    const groups = groupDocumentVersions([row("v3", "v2"), row("v1")]);
    expect(groups.map((g) => g.latest.id)).toEqual(["v3", "v1"]);
    expect(groups[0].older).toEqual([]);
  });

  it("shows an older version as the latest when its newer one is in Trash", () => {
    // v3 superseded v2 and is in Trash, so it isn't passed in.
    const groups = groupDocumentVersions([row("v2", "v1"), row("v1")]);
    expect(groups.map((g) => g.latest.id)).toEqual(["v2"]);
    expect(ids(groups[0].older)).toEqual(["v1"]);
  });

  it("doesn't loop on a cycle", () => {
    const groups = groupDocumentVersions([row("a", "b"), row("b", "a"), row("c")]);
    // Neither is the latest of anything, so only c is listed. The app never
    // writes a cycle (supersedesId is unique and points at an older row).
    expect(groups.map((g) => g.latest.id)).toEqual(["c"]);
  });

  it("keeps extra columns on the rows it returns", () => {
    const [group] = groupDocumentVersions([{ ...row("p"), kind: "PHOTO" }]);
    expect(group.latest.kind).toBe("PHOTO");
  });
});

describe("documentTypeLabel", () => {
  it("names the Document type", () => {
    expect(documentTypeLabel({ category: "SERVICE_RECORD" })).toBe("Service record");
    expect(documentTypeLabel({ category: "OTHER" })).toBe("Other");
  });

  it("shows no pill for a Document with no type", () => {
    expect(documentTypeLabel({ category: null })).toBeNull();
  });

  it("falls back to a Warranty Document's legacy kind", () => {
    expect(documentTypeLabel({ category: null }, "PHOTO")).toBe("Photo");
    expect(documentTypeLabel({ category: "RECEIPT" }, "INVOICE")).toBe("Receipt");
    expect(documentTypeLabel({ category: null }, "SOMETHING_ELSE")).toBeNull();
  });

  it("shows an unknown stored type as it is", () => {
    expect(documentCategoryLabel("LEGACY_TYPE")).toBe("LEGACY_TYPE");
    expect(documentCategoryLabel("")).toBeNull();
  });
});

describe("showsThumbnail", () => {
  it("shows images typed Photo, or legacy Warranty photos", () => {
    expect(showsThumbnail({ category: "PHOTO", mimeType: "image/jpeg" })).toBe(true);
    expect(showsThumbnail({ category: null, mimeType: "image/png" }, "PHOTO")).toBe(true);
  });

  it("uses a file icon for everything else", () => {
    expect(showsThumbnail({ category: "PHOTO", mimeType: "application/pdf" })).toBe(false);
    expect(showsThumbnail({ category: "RECEIPT", mimeType: "image/jpeg" }, "PHOTO")).toBe(false);
    expect(showsThumbnail({ category: null, mimeType: "image/jpeg" })).toBe(false);
  });
});
