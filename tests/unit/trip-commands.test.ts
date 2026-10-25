import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createTripCommand,
  updateTripCommand,
  deleteTripCommand,
  restoreTripCommand,
  permanentlyDeleteTripCommand,
  purgeTrip,
  createTripSegmentCommand,
  updateTripSegmentCommand,
  permanentlyDeleteTripSegmentCommand,
  saveTripSegmentFlightData,
} from "@/lib/commands/trips";
import { RecordNotFoundError, StaleEditError } from "@/lib/commands/shared";
import { ModuleDisabledError } from "@/lib/modules/enablement";
import { fullFormUpdate } from "@/lib/validation/fullFormUpdate";
import { tripSchema, tripSegmentSchema } from "@/lib/validation/travel";
import { formToTripInput, formToTripSegmentInput } from "@/lib/formMappers";
import { purgeExpiredTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { createTrip, updateTrip, deleteTrip, restoreTrip, updateTripSegment, deleteTripSegment } from "@/lib/actions/trips";
import { auth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
// The server actions' sign-in; each action test sets the session it needs.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// redirect() throws in Next; make it a recognisable throw here.
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT ${url}`);
  }),
}));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  await setModuleEnabled("TRAVEL", true);
});

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// Puts a file where storage.ts keeps a Trip segment's Documents, plus the
// row pointing at it, so permanent delete has something real to clean up.
async function attachFile(tripSegmentId: string, options: { storedName?: string; deletedAt?: Date } = {}) {
  const storedName = options.storedName ?? "stored.pdf";
  const dir = path.join(db.uploadsDir, "trip-segments", tripSegmentId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedName), "%PDF-1.4 test");
  await db.prisma.tripSegmentDocument.create({
    data: {
      tripSegmentId,
      filename: "booking.pdf",
      storedName,
      mimeType: "application/pdf",
      size: 13,
      deletedAt: options.deletedAt,
    },
  });
  return dir;
}

// Parses an edit form's submission the way the action and the sync route do.
function formData(values: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(values)) fd.append(key, value);
  return fd;
}

const flight = { type: "FLIGHT" as const, title: "SYD → NRT", currency: "AUD" };

describe("Trip commands", () => {
  it("creates a Trip with the actor as creator and revalidates the list", async () => {
    const trip = await createTripCommand({ title: "Japan", destination: "Tokyo" }, actorId);
    expect(await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      title: "Japan",
      destination: "Tokyo",
      createdById: actorId,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/travel");
  });

  it("applies a partial patch, leaving other fields alone", async () => {
    const trip = await createTripCommand({ title: "Bali", destination: "Ubud", notes: "Villa" }, actorId);
    const editor = await createTestUser();
    await updateTripCommand(trip.id, { destination: "Canggu" }, editor.id);
    expect(await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      title: "Bali",
      destination: "Canggu",
      notes: "Villa",
      updatedById: editor.id,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/travel/${trip.id}`);
  });

  it("clears the fields a full edit form submitted blank", async () => {
    const trip = await createTripCommand(
      { title: "NZ", destination: "Queenstown", startDate: new Date("2027-01-02"), notes: "Ski" },
      actorId,
    );
    const submission = formData({ title: "NZ", destination: "", startDate: "", endDate: "", notes: "" });
    const parsed = tripSchema.parse(formToTripInput(submission));
    await updateTripCommand(trip.id, fullFormUpdate(tripSchema, parsed, submission), actorId);
    expect(await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      title: "NZ",
      destination: null,
      startDate: null,
      notes: null,
    });
  });

  it("soft deletes to Trash and restores, keeping its segments", async () => {
    const trip = await createTripCommand({ title: "Fiji" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, { type: "LODGING", title: "Resort", currency: "AUD" });
    await deleteTripCommand(trip.id);
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).deletedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/trash");

    await restoreTripCommand(trip.id);
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).deletedAt).toBeNull();
    expect(await db.prisma.tripSegment.findUnique({ where: { id: segment.id } })).not.toBeNull();
  });

  it("permanently deletes the Trip, its segments, their Documents and files", async () => {
    const trip = await createTripCommand({ title: "Europe" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    const dir = await attachFile(segment.id);

    await permanentlyDeleteTripCommand(trip.id);

    expect(await db.prisma.trip.findUnique({ where: { id: trip.id } })).toBeNull();
    expect(await db.prisma.tripSegment.findUnique({ where: { id: segment.id } })).toBeNull();
    expect(await db.prisma.tripSegmentDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
  });

  it("purges for Trash retention even with the Travel module off", async () => {
    const trip = await createTripCommand({ title: "Old trip" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    const dir = await attachFile(segment.id);
    await setModuleEnabled("TRAVEL", false);

    await purgeTrip(trip.id);

    expect(await db.prisma.trip.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
  });

  it("refuses a stale edit and accepts a current one", async () => {
    const trip = await createTripCommand({ title: "USA" }, actorId);
    const loadedAt = trip.updatedAt.toISOString();

    // Someone else edits first; updatedAt moves on.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateTripCommand(trip.id, { destination: "New York" }, actorId);

    await expect(
      updateTripCommand(trip.id, { destination: "Boston" }, actorId, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).destination).toBe("New York");

    const current = await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } });
    await updateTripCommand(trip.id, { destination: "Boston" }, actorId, { baseUpdatedAt: current.updatedAt });
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).destination).toBe("Boston");
  });

  it("reports a missing Trip as not found", async () => {
    await expect(updateTripCommand("missing", { title: "x" }, actorId)).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(deleteTripCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(restoreTripCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(permanentlyDeleteTripCommand("missing")).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("rejects every write when the Travel module is disabled", async () => {
    const trip = await createTripCommand({ title: "Paris" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    await setModuleEnabled("TRAVEL", false);

    const writes = [
      () => createTripCommand({ title: "Another" }, actorId),
      () => updateTripCommand(trip.id, { title: "Renamed" }, actorId),
      () => deleteTripCommand(trip.id),
      () => restoreTripCommand(trip.id),
      () => permanentlyDeleteTripCommand(trip.id),
      () => createTripSegmentCommand(trip.id, { type: "ACTIVITY", title: "Louvre", currency: "EUR" }),
      () => updateTripSegmentCommand(segment.id, { title: "Renamed" }),
      () => permanentlyDeleteTripSegmentCommand(segment.id),
    ];
    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(ModuleDisabledError);
    }
    expect(await db.prisma.trip.count()).toBe(1);
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).title).toBe("Paris");
    expect(await db.prisma.tripSegment.count()).toBe(1);
  });
});

describe("Trip segment commands", () => {
  let tripId: string;

  beforeEach(async () => {
    tripId = (await createTripCommand({ title: "Japan" }, actorId)).id;
  });

  it("creates a segment on its Trip", async () => {
    const segment = await createTripSegmentCommand(tripId, { ...flight, flightNumber: "QF25", cost: 1200 });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).toMatchObject({
      tripId,
      title: "SYD → NRT",
      flightNumber: "QF25",
      cost: 1200,
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/travel/${tripId}`);
  });

  it("won't create a segment on a missing Trip", async () => {
    await expect(createTripSegmentCommand("missing", flight)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it("applies a partial patch and enforces the Trip scope", async () => {
    const segment = await createTripSegmentCommand(tripId, { ...flight, provider: "Qantas", flightNumber: "QF25" });
    await updateTripSegmentCommand(segment.id, { confirmationCode: "ABC123" }, { tripId });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).toMatchObject({
      provider: "Qantas",
      flightNumber: "QF25",
      confirmationCode: "ABC123",
    });

    const otherTrip = await createTripCommand({ title: "Other" }, actorId);
    await expect(
      updateTripSegmentCommand(segment.id, { title: "x" }, { tripId: otherTrip.id }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(
      permanentlyDeleteTripSegmentCommand(segment.id, { tripId: otherTrip.id }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(await db.prisma.tripSegment.findUnique({ where: { id: segment.id } })).not.toBeNull();
  });

  it("clears the fields a full edit form submitted blank", async () => {
    const segment = await createTripSegmentCommand(tripId, {
      ...flight,
      provider: "Qantas",
      cost: 900,
      flightNumber: "QF25",
      notes: "Window seat",
    });
    const submission = formData({
      type: "FLIGHT",
      title: "SYD → NRT",
      provider: "",
      confirmationCode: "",
      startDate: "",
      endDate: "",
      location: "",
      cost: "",
      currency: "AUD",
      notes: "",
      flightNumber: "QF25",
      departureIata: "",
      arrivalIata: "",
    });
    const parsed = tripSegmentSchema.parse(formToTripSegmentInput(submission));
    await updateTripSegmentCommand(segment.id, fullFormUpdate(tripSegmentSchema, parsed, submission), { tripId });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).toMatchObject({
      flightNumber: "QF25",
      provider: null,
      cost: null,
      notes: null,
    });
  });

  it("refuses a stale edit", async () => {
    const segment = await createTripSegmentCommand(tripId, flight);
    const loadedAt = segment.updatedAt.toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await updateTripSegmentCommand(segment.id, { title: "SYD → HND" });
    await expect(
      updateTripSegmentCommand(segment.id, { title: "SYD → KIX" }, { baseUpdatedAt: loadedAt }),
    ).rejects.toBeInstanceOf(StaleEditError);
    expect((await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).title).toBe("SYD → HND");
  });

  // Segments have no Trash (no deletedAt): their delete is permanent.
  it("permanently deletes the segment with its Documents and files, keeping the Trip", async () => {
    const segment = await createTripSegmentCommand(tripId, flight);
    const dir = await attachFile(segment.id);

    await permanentlyDeleteTripSegmentCommand(segment.id, { tripId });

    expect(await db.prisma.tripSegment.findUnique({ where: { id: segment.id } })).toBeNull();
    expect(await db.prisma.tripSegmentDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await db.prisma.trip.findUnique({ where: { id: tripId } })).not.toBeNull();
    expect(revalidatePath).toHaveBeenCalledWith(`/travel/${tripId}`);
  });

  it("leaves the flight fields alone when a non-flight form doesn't submit them", async () => {
    const segment = await createTripSegmentCommand(tripId, {
      type: "ACTIVITY",
      title: "Tour",
      currency: "AUD",
      flightNumber: "QF25",
      departureIata: "SYD",
    });
    // The form hides the flight inputs for a non-flight segment, so they're
    // not in its submission at all.
    const submission = formData({
      type: "ACTIVITY",
      title: "Night tour",
      provider: "",
      confirmationCode: "",
      startDate: "",
      endDate: "",
      location: "",
      cost: "",
      currency: "AUD",
      notes: "",
    });
    const parsed = tripSegmentSchema.parse(formToTripSegmentInput(submission));
    await updateTripSegmentCommand(segment.id, fullFormUpdate(tripSegmentSchema, parsed, submission), { tripId });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).toMatchObject({
      title: "Night tour",
      flightNumber: "QF25",
      departureIata: "SYD",
    });
  });
});

describe("saveTripSegmentFlightData", () => {
  let tripId: string;

  beforeEach(async () => {
    tripId = (await createTripCommand({ title: "Japan" }, actorId)).id;
  });

  it("stores flight lookup results without touching the user's fields", async () => {
    const segment = await createTripSegmentCommand(tripId, { ...flight, flightNumber: "QF25", notes: "Aisle" });
    const at = new Date("2027-01-01T00:00:00Z");
    expect(
      await saveTripSegmentFlightData(segment.id, { flightStatus: "landed", depGate: "12", flightStatusAt: at, distanceKm: 7800 }),
    ).toBe(true);
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).toMatchObject({
      flightStatus: "landed",
      depGate: "12",
      flightStatusAt: at,
      distanceKm: 7800,
      notes: "Aisle",
      flightNumber: "QF25",
    });
  });

  it("keeps updatedAt, so an offline edit queued before the lookup still lands", async () => {
    const segment = await createTripSegmentCommand(tripId, { ...flight, flightNumber: "QF25" });
    const queuedFrom = segment.updatedAt.toISOString();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveTripSegmentFlightData(segment.id, { flightStatus: "active", flightStatusAt: new Date() });
    const afterLookup = await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } });
    expect(afterLookup.updatedAt.toISOString()).toBe(queuedFrom);

    await updateTripSegmentCommand(segment.id, { confirmationCode: "XYZ789" }, { tripId, baseUpdatedAt: queuedFrom });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).toMatchObject({
      confirmationCode: "XYZ789",
      flightStatus: "active",
    });
  });

  it("only fills in airport codes the user left blank", async () => {
    const typed = await createTripSegmentCommand(tripId, { ...flight, departureIata: "SYD", arrivalIata: "HND" });
    await saveTripSegmentFlightData(typed.id, { departureIata: "MEL", arrivalIata: "NRT" });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: typed.id } })).toMatchObject({
      departureIata: "SYD",
      arrivalIata: "HND",
    });

    const blank = await createTripSegmentCommand(tripId, { ...flight, arrivalIata: "HND" });
    await saveTripSegmentFlightData(blank.id, { departureIata: "SYD", arrivalIata: "NRT" });
    expect(await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: blank.id } })).toMatchObject({
      departureIata: "SYD",
      arrivalIata: "HND",
    });
  });

  it("reports a missing segment as not found", async () => {
    await expect(saveTripSegmentFlightData("missing", { flightStatus: "landed" })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });
});

describe("Trash retention for Trips", () => {
  it("purges an expired Trip with its segments, their Documents (Trash ones too) and files", async () => {
    const longAgo = new Date(Date.now() - (TRASH_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000);
    const trip = await createTripCommand({ title: "Expired" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    const dir = await attachFile(segment.id);
    await attachFile(segment.id, { storedName: "trashed.pdf", deletedAt: longAgo });
    await db.prisma.trip.update({ where: { id: trip.id }, data: { deletedAt: longAgo } });

    const recent = await createTripCommand({ title: "Recently trashed" }, actorId);
    await deleteTripCommand(recent.id);

    await purgeExpiredTrash();

    expect(await db.prisma.trip.findUnique({ where: { id: trip.id } })).toBeNull();
    expect(await db.prisma.tripSegment.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await db.prisma.tripSegmentDocument.count()).toBe(0);
    expect(await exists(dir)).toBe(false);
    expect(await db.prisma.trip.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

describe("Trip server actions", () => {
  function signInAs(role: "ADMIN" | "MEMBER" | "READONLY") {
    vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role } } as never);
  }

  it("refuse a read-only member before writing anything", async () => {
    const trip = await createTripCommand({ title: "Keep" }, actorId);
    signInAs("READONLY");
    await expect(createTrip({}, formData({ title: "New" }))).rejects.toThrow("read-only");
    await expect(updateTrip(trip.id, {}, formData({ title: "Changed" }))).rejects.toThrow("read-only");
    await expect(deleteTrip(trip.id)).rejects.toThrow("read-only");
    expect(await db.prisma.trip.count()).toBe(1);
    expect(await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).toMatchObject({
      title: "Keep",
      deletedAt: null,
    });
  });

  it("turn a command's not-found into the form's error", async () => {
    signInAs("MEMBER");
    expect(await updateTrip("missing", {}, formData({ title: "x" }))).toEqual({ error: "Trip not found." });
    expect(await restoreTrip("missing")).toEqual({ error: "Trip not found." });

    const trip = await createTripCommand({ title: "Mine" }, actorId);
    const other = await createTripCommand({ title: "Other" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    expect(await deleteTripSegment(other.id, segment.id)).toEqual({ error: "Segment not found." });
    expect(
      await updateTripSegment(other.id, segment.id, {}, formData({ type: "FLIGHT", title: "x", currency: "AUD" })),
    ).toEqual({ error: "Segment not found." });
    expect(await db.prisma.tripSegment.findUnique({ where: { id: segment.id } })).not.toBeNull();
  });

  it("write through the command and redirect on success", async () => {
    signInAs("MEMBER");
    await expect(createTrip({}, formData({ title: "Via action", destination: "Hobart" }))).rejects.toThrow(
      /^REDIRECT \/travel\//,
    );
    expect(await db.prisma.trip.findFirstOrThrow({ where: { title: "Via action" } })).toMatchObject({
      destination: "Hobart",
      createdById: actorId,
    });
  });
});

// The offline sync handler goes through the same commands.
describe("sync entities for Trips", () => {
  it("creates, refuses a stale update, and soft deletes through the commands", async () => {
    const { ENTITY_SYNC_CONFIGS } = await import("@/app/api/sync/entityHandlers");
    const sync = ENTITY_SYNC_CONFIGS.trip;
    const { id } = await sync.create!({ title: "Synced trip" }, { userId: actorId });
    const loaded = await db.prisma.trip.findUniqueOrThrow({ where: { id } });
    expect(loaded.createdById).toBe(actorId);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await sync.update!(id, { destination: "Perth" }, { userId: actorId, baseUpdatedAt: loaded.updatedAt.toISOString() });
    await expect(
      sync.update!(id, { destination: "Darwin" }, { userId: actorId, baseUpdatedAt: loaded.updatedAt.toISOString() }),
    ).rejects.toThrow("changed elsewhere");

    const segmentSync = ENTITY_SYNC_CONFIGS.tripSegment;
    const segment = await segmentSync.create!(flight, { userId: actorId, parentId: id });
    expect((await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).tripId).toBe(id);
    const other = await createTripCommand({ title: "Other" }, actorId);
    await expect(
      segmentSync.update!(segment.id, { title: "x" }, { userId: actorId, parentId: other.id }),
    ).rejects.toThrow("Segment not found");

    await sync.remove!(id, { userId: actorId });
    const row = await db.prisma.trip.findUniqueOrThrow({ where: { id } });
    expect(row.destination).toBe("Perth");
    expect(row.deletedAt).toBeInstanceOf(Date);
  });
});
