import { describe, expect, it } from "vitest";
import {
  documentTypeLabel,
  groupDocumentVersions,
  isBrowserViewableImage,
  olderVersionShowsStar,
  showsThumbnail,
  type DocumentListRow,
} from "@/lib/documents/documentList";
import { documentCategoryLabel } from "@/lib/documents/categories";
import { isPreviewable } from "@/components/DocumentPreviewModal";

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
const latestIds = (groups: { latest: DocumentListRow }[]) => groups.map((g) => g.latest.id);

describe("groupDocumentVersions", () => {
  it("lists unrelated Documents each on their own, in the order given", () => {
    const groups = groupDocumentVersions([row("a"), row("b")]);
    expect(latestIds(groups)).toEqual(["a", "b"]);
    expect(groups.every((g) => g.older.length === 0)).toBe(true);
  });

  it("puts older versions under the latest one, newest first", () => {
    // Newest upload first, as the pages order them.
    const groups = groupDocumentVersions([row("v3", "v2"), row("other"), row("v2", "v1"), row("v1")]);
    expect(latestIds(groups)).toEqual(["v3", "other"]);
    expect(ids(groups[0].older)).toEqual(["v2", "v1"]);
  });

  it("shows the newest listed version as the latest when the newest is in Trash", () => {
    // v1 ← v2 ← v3, v3 in Trash.
    const groups = groupDocumentVersions([row("v2", "v1"), row("v1")], [{ id: "v3", supersedesId: "v2" }]);
    expect(latestIds(groups)).toEqual(["v2"]);
    expect(ids(groups[0].older)).toEqual(["v1"]);
  });

  it("keeps one Document when a new version is filed on top of a version in Trash", () => {
    // v1 ← v2 ← v3, v3 in Trash, then v4 filed from the Inbox supersedes v3.
    const groups = groupDocumentVersions(
      [row("v4", "v3"), row("v2", "v1"), row("v1")],
      [{ id: "v3", supersedesId: "v2" }],
    );
    expect(latestIds(groups)).toEqual(["v4"]);
    expect(ids(groups[0].older)).toEqual(["v2", "v1"]);
  });

  it("keeps one Document when a middle version is in Trash", () => {
    // v1 ← v2 ← v3, v2 in Trash.
    const groups = groupDocumentVersions([row("v3", "v2"), row("v1")], [{ id: "v2", supersedesId: "v1" }]);
    expect(latestIds(groups)).toEqual(["v3"]);
    expect(ids(groups[0].older)).toEqual(["v1"]);
  });

  it("without the Trash links, a version in Trash ends the chain there", () => {
    const groups = groupDocumentVersions([row("v3", "v2"), row("v1")]);
    expect(latestIds(groups)).toEqual(["v3", "v1"]);
  });

  it("lists every Document even with a cycle or self-reference", () => {
    // The app never writes these (supersedesId is unique and points at an
    // older row), but nothing may disappear from the list if one exists.
    const cycle = groupDocumentVersions([row("a", "b"), row("b", "a"), row("c")]);
    expect(latestIds(cycle)).toEqual(["a", "b", "c"]);
    const self = groupDocumentVersions([row("s", "s"), row("t")]);
    expect(latestIds(self)).toEqual(["s", "t"]);
    expect(self[0].older).toEqual([]);
  });

  it("lists each row exactly once", () => {
    const docs = [row("v4", "v3"), row("x"), row("v2", "v1"), row("v1"), row("y", "y")];
    const groups = groupDocumentVersions(docs, [{ id: "v3", supersedesId: "v2" }]);
    const shown = groups.flatMap((g) => [g.latest.id, ...ids(g.older)]);
    expect([...shown].sort()).toEqual(ids(docs).sort());
  });

  it("keeps extra columns on the rows it returns", () => {
    const [group] = groupDocumentVersions([{ ...row("p"), kind: "PHOTO" }]);
    expect(group.latest.kind).toBe("PHOTO");
  });
});

describe("olderVersionShowsStar", () => {
  it("shows the star on a starred older version, so it can be unstarred", () => {
    // Filing a new version doesn't carry the star over: v2 is unstarred,
    // v1 still starred and listed under it.
    const [group] = groupDocumentVersions([row("v2", "v1"), row("v1", null, { isImportant: true })]);
    expect(group.latest.isImportant).toBe(false);
    expect(group.older.map(olderVersionShowsStar)).toEqual([true]);
  });

  it("shows no star on an unstarred older version", () => {
    expect(olderVersionShowsStar(row("v1"))).toBe(false);
  });
});

describe("documentTypeLabel", () => {
  it("names the Document type", () => {
    expect(documentTypeLabel({ category: "SERVICE_RECORD" })).toBe("Service record");
    expect(documentTypeLabel({ category: "OTHER" })).toBe("Other");
  });

  it("shows no pill for a Document with no type, or a value that isn't a Document type", () => {
    expect(documentTypeLabel({ category: null })).toBeNull();
    expect(documentTypeLabel({ category: "LEGACY_TYPE" })).toBeNull();
    expect(documentCategoryLabel("LEGACY_TYPE")).toBeNull();
    expect(documentCategoryLabel("")).toBeNull();
  });

  it("falls back to a Warranty Document's legacy kind", () => {
    expect(documentTypeLabel({ category: null }, "PHOTO")).toBe("Photo");
    expect(documentTypeLabel({ category: "RECEIPT" }, "INVOICE")).toBe("Receipt");
    expect(documentTypeLabel({ category: "UNKNOWN" }, "MANUAL")).toBe("Manual");
    expect(documentTypeLabel({ category: null }, "SOMETHING_ELSE")).toBeNull();
  });
});

describe("showsThumbnail and preview", () => {
  it("shows images typed Photo, or legacy Warranty photos", () => {
    expect(showsThumbnail({ category: "PHOTO", mimeType: "image/jpeg" })).toBe(true);
    expect(showsThumbnail({ category: null, mimeType: "image/png" }, "PHOTO")).toBe(true);
  });

  it("uses a file icon for everything else", () => {
    expect(showsThumbnail({ category: "PHOTO", mimeType: "application/pdf" })).toBe(false);
    expect(showsThumbnail({ category: "RECEIPT", mimeType: "image/jpeg" }, "PHOTO")).toBe(false);
    expect(showsThumbnail({ category: null, mimeType: "image/jpeg" })).toBe(false);
  });

  it("neither thumbnails nor previews HEIC photos, which browsers can't show", () => {
    expect(isBrowserViewableImage("image/heic")).toBe(false);
    expect(showsThumbnail({ category: "PHOTO", mimeType: "image/heic" })).toBe(false);
    expect(isPreviewable("image/heic")).toBe(false);
    expect(isPreviewable("image/jpeg")).toBe(true);
    expect(isPreviewable("application/pdf")).toBe(true);
  });
});
