import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setupTestDb, createTestUser, setModuleEnabled } from "../helpers/testDb";
import {
  createVehicleCommand,
  updateVehicleCommand,
  deleteVehicleCommand,
  restoreVehicleCommand,
  permanentlyDeleteVehicleCommand,
  createServiceRecordCommand,
  updateServiceRecordCommand,
  deleteServiceRecordCommand,
  restoreServiceRecordCommand,
  permanentlyDeleteServiceRecordCommand,
} from "@/lib/commands/vehicles";
import {
  createTripCommand,
  updateTripCommand,
  deleteTripCommand,
  restoreTripCommand,
  createTripSegmentCommand,
  updateTripSegmentCommand,
  permanentlyDeleteTripSegmentCommand,
  saveTripSegmentFlightData,
} from "@/lib/commands/trips";
import { refreshFlightStatus } from "@/lib/integrations/flightStatus";
import { computeSegmentDistance } from "@/lib/integrations/flightDistance";
import { documentStoreFor } from "@/lib/storage";
import {
  createPropertyCommand,
  deletePropertyCommand,
  restorePropertyCommand,
  createMaintenanceRecordCommand,
  updateMaintenanceRecordCommand,
  deleteMaintenanceRecordCommand,
  restoreMaintenanceRecordCommand,
  createTenancyCommand,
  updateTenancyCommand,
} from "@/lib/commands/home";
import {
  addDocumentCommand,
  deleteDocumentCommand,
  restoreDocumentCommand,
  setDocumentImportantCommand,
} from "@/lib/commands/documents";
import {
  findLiveParent,
  requireLive,
  requireExisting,
  assertParentRestored,
  ParentInTrashError,
  RecordNotFoundError,
  RecordValidationError,
} from "@/lib/commands/shared";
import { restoreVehicleItem } from "@/lib/actions/vehicles";
import { restoreHomeItem } from "@/lib/actions/home";
import { restoreDocumentAction, setDocumentImportantAction } from "@/lib/actions/documents";
import { homeItemSchema, propertySchema } from "@/lib/validation/home";
import { auth } from "@/lib/auth";

// #428: a record in Trash is read-only until it's restored, and so is
// everything under it. Creates and updates under a trashed parent are
// refused as not found; a child can't be restored while its parent is in
// Trash; delete, restore and permanent delete still work.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
// A configured AviationStack key, so the flight lookups get as far as the API.
vi.mock("@/lib/appSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/appSettings")>()),
  getAviationStackConfig: vi.fn(async () => ({ apiKey: "test-key" })),
}));

const db = setupTestDb();

let actorId: string;

beforeEach(async () => {
  vi.clearAllMocks();
  actorId = (await createTestUser()).id;
  vi.mocked(auth).mockResolvedValue({ user: { id: actorId, role: "MEMBER" } } as never);
  for (const key of ["VEHICLES", "TRAVEL", "HOME"] as const) await setModuleEnabled(key, true);
});

const service = { type: "SERVICE" as const, title: "Logbook service", currency: "AUD" };
const flight = { type: "FLIGHT" as const, title: "SYD → NRT", currency: "AUD" };
const maintenance = () => homeItemSchema.parse({ type: "MAINTENANCE", title: "Gutter clean" });

function pdf() {
  return new File(["%PDF-1.4\n% test document\n"], "receipt.pdf", { type: "application/pdf" });
}

describe("shared Trash helpers", () => {
  it("treat missing and trashed records as not found, and rows with no Trash as live", async () => {
    expect(() => requireLive(null, "Vehicle")).toThrow("Vehicle not found");
    expect(() => requireLive({ deletedAt: new Date() }, "Vehicle")).toThrow(RecordNotFoundError);
    expect(requireLive({ deletedAt: null, id: "a" }, "Vehicle").id).toBe("a");
    // A table with no Trash (Portfolios, Holdings) goes through requireExisting.
    expect(requireExisting({ id: "b" }, "Holding").id).toBe("b");
    await expect(findLiveParent(Promise.resolve({ deletedAt: new Date() }), "Segment")).rejects.toThrow(
      "Segment not found",
    );
  });

  it("refuse a restore under a trashed parent with a message naming it", () => {
    expect(() => assertParentRestored({ deletedAt: new Date() }, "Vehicle")).toThrow("Restore the vehicle first.");
    const error = (() => {
      try {
        assertParentRestored({ deletedAt: new Date() }, "Property");
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ParentInTrashError);
    expect(error).toBeInstanceOf(RecordValidationError);
    expect(() => assertParentRestored({ deletedAt: null }, "Trip")).not.toThrow();
  });
});

describe("Vehicles under Trash", () => {
  it("refuses writes under a trashed Vehicle and allows them again once it's restored", async () => {
    const vehicle = await createVehicleCommand({ label: "Family car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    await deleteVehicleCommand(vehicle.id);

    const refused = [
      () => updateVehicleCommand(vehicle.id, { label: "Renamed" }, actorId),
      () => createServiceRecordCommand(vehicle.id, { ...service, title: "Offline" }),
      () => updateServiceRecordCommand(item.id, { title: "Renamed" }),
      () => updateServiceRecordCommand(item.id, { title: "Renamed" }, { vehicleId: vehicle.id }),
    ];
    for (const write of refused) {
      await expect(write()).rejects.toBeInstanceOf(RecordNotFoundError);
    }
    expect(await db.prisma.vehicleItem.count()).toBe(1);
    expect((await db.prisma.vehicle.findUniqueOrThrow({ where: { id: vehicle.id } })).label).toBe("Family car");
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(service.title);

    // Delete still works on a child under a trashed parent.
    await deleteServiceRecordCommand(item.id, { vehicleId: vehicle.id });

    await restoreVehicleCommand(vehicle.id);
    await updateVehicleCommand(vehicle.id, { label: "Renamed" }, actorId);
    await createServiceRecordCommand(vehicle.id, { ...service, title: "After restore" });
    expect(await db.prisma.vehicleItem.count()).toBe(2);
  });

  it("refuses an update to a Service record that's itself in Trash", async () => {
    const vehicle = await createVehicleCommand({ label: "Ute" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    await deleteServiceRecordCommand(item.id);
    await expect(updateServiceRecordCommand(item.id, { title: "x" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await restoreServiceRecordCommand(item.id);
    await updateServiceRecordCommand(item.id, { title: "x" });
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("x");
  });

  it("won't restore a Service record while its Vehicle is in Trash", async () => {
    const vehicle = await createVehicleCommand({ label: "Wagon" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    await deleteServiceRecordCommand(item.id);
    await deleteVehicleCommand(vehicle.id);

    await expect(restoreServiceRecordCommand(item.id)).rejects.toThrow("Restore the vehicle first.");
    expect(await restoreVehicleItem(item.id)).toEqual({ error: "Restore the vehicle first." });
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeInstanceOf(Date);

    await restoreVehicleCommand(vehicle.id);
    await restoreServiceRecordCommand(item.id);
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).deletedAt).toBeNull();
  });

  it("still permanently deletes a Service record and its Vehicle from Trash", async () => {
    const vehicle = await createVehicleCommand({ label: "Old bike" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    await deleteServiceRecordCommand(item.id);
    await deleteVehicleCommand(vehicle.id);
    await permanentlyDeleteServiceRecordCommand(item.id);
    await permanentlyDeleteVehicleCommand(vehicle.id);
    expect(await db.prisma.vehicle.count()).toBe(0);
  });
});

describe("Trips under Trash", () => {
  it("refuses writes under a trashed Trip and allows them again once it's restored", async () => {
    const trip = await createTripCommand({ title: "Japan" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    await deleteTripCommand(trip.id);

    const refused = [
      () => updateTripCommand(trip.id, { destination: "Tokyo" }, actorId),
      () => createTripSegmentCommand(trip.id, { ...flight, title: "Offline" }),
      () => updateTripSegmentCommand(segment.id, { title: "Renamed" }),
      () => updateTripSegmentCommand(segment.id, { title: "Renamed" }, { tripId: trip.id }),
    ];
    for (const write of refused) {
      await expect(write()).rejects.toBeInstanceOf(RecordNotFoundError);
    }
    expect(await db.prisma.tripSegment.count()).toBe(1);
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).destination).toBeNull();

    await restoreTripCommand(trip.id);
    await updateTripCommand(trip.id, { destination: "Tokyo" }, actorId);
    await updateTripSegmentCommand(segment.id, { title: "Renamed" });
    await createTripSegmentCommand(trip.id, { ...flight, title: "After restore" });
    expect(await db.prisma.tripSegment.count()).toBe(2);
  });

  it("doesn't save flight lookups under a trashed Trip, and still deletes its segments", async () => {
    const trip = await createTripCommand({ title: "Perth" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    await deleteTripCommand(trip.id);

    expect(await saveTripSegmentFlightData(segment.id, { flightStatus: "landed" })).toBe(false);
    expect((await db.prisma.tripSegment.findUniqueOrThrow({ where: { id: segment.id } })).flightStatus).toBeNull();

    await restoreTripCommand(trip.id);
    expect(await saveTripSegmentFlightData(segment.id, { flightStatus: "landed" })).toBe(true);

    await deleteTripCommand(trip.id);
    await permanentlyDeleteTripSegmentCommand(segment.id);
    expect(await db.prisma.tripSegment.count()).toBe(0);
  });
});

describe("flight lookups under a trashed Trip", () => {
  it("don't call AviationStack for a segment of a Trip in Trash", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    try {
      const trip = await createTripCommand({ title: "Japan" }, actorId);
      const segment = await createTripSegmentCommand(trip.id, {
        ...flight,
        flightNumber: "QF25",
        departureIata: "SYD",
        arrivalIata: "NRT",
      });
      await deleteTripCommand(trip.id);
      await refreshFlightStatus(segment.id);
      await computeSegmentDistance(segment.id);
      expect(fetchSpy).not.toHaveBeenCalled();

      await restoreTripCommand(trip.id);
      await refreshFlightStatus(segment.id);
      expect(fetchSpy).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe("Properties under Trash", () => {
  it("won't restore a Maintenance record while its Property is in Trash", async () => {
    const property = await createPropertyCommand(propertySchema.parse({ label: "Beach house" }), actorId);
    const item = await createMaintenanceRecordCommand(property.id, maintenance());
    await deleteMaintenanceRecordCommand(item.id);
    await deletePropertyCommand(property.id);

    await expect(createMaintenanceRecordCommand(property.id, maintenance())).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(updateMaintenanceRecordCommand(item.id, { title: "x" })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(restoreMaintenanceRecordCommand(item.id)).rejects.toThrow("Restore the property first.");
    expect(await restoreHomeItem(item.id)).toEqual({ error: "Restore the property first." });

    await restorePropertyCommand(property.id);
    await restoreMaintenanceRecordCommand(item.id);
    await updateMaintenanceRecordCommand(item.id, { title: "x" });
    expect((await db.prisma.homeItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe("x");
  });
});

describe("Documents under Trash", () => {
  it("won't add a Document under a trashed record or a trashed parent", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    const trip = await createTripCommand({ title: "Japan" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);

    await deleteVehicleCommand(vehicle.id);
    await deleteTripCommand(trip.id);
    await expect(addDocumentCommand("VEHICLE_ITEM", item.id, { file: pdf() })).rejects.toThrow(
      "Service record not found",
    );
    await expect(addDocumentCommand("TRIP_SEGMENT", segment.id, { file: pdf() })).rejects.toThrow("Segment not found");

    await restoreVehicleCommand(vehicle.id);
    await deleteServiceRecordCommand(item.id);
    await expect(addDocumentCommand("VEHICLE_ITEM", item.id, { file: pdf() })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await db.prisma.vehicleItemDocument.count()).toBe(0);
    expect(await db.prisma.tripSegmentDocument.count()).toBe(0);

    await restoreServiceRecordCommand(item.id);
    await restoreTripCommand(trip.id);
    await addDocumentCommand("VEHICLE_ITEM", item.id, { file: pdf() });
    await addDocumentCommand("TRIP_SEGMENT", segment.id, { file: pdf() });
    expect(await db.prisma.vehicleItemDocument.count()).toBe(1);
    expect(await db.prisma.tripSegmentDocument.count()).toBe(1);
  });

  it("won't star a Document while its record or that record's parent is in Trash", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    const doc = await addDocumentCommand("VEHICLE_ITEM", item.id, { file: pdf() });
    const starred = async () =>
      (await db.prisma.vehicleItemDocument.findUniqueOrThrow({ where: { id: doc.id } })).isImportant;

    await deleteVehicleCommand(vehicle.id);
    await expect(setDocumentImportantCommand("VEHICLE_ITEM", doc.id, true)).rejects.toThrow("Document not found");
    expect(await setDocumentImportantAction("VEHICLE_ITEM", doc.id, true)).toEqual({ error: "Document not found." });
    await restoreVehicleCommand(vehicle.id);

    await deleteServiceRecordCommand(item.id);
    await expect(setDocumentImportantCommand("VEHICLE_ITEM", doc.id, true)).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await starred()).toBe(false);

    await restoreServiceRecordCommand(item.id);
    await setDocumentImportantCommand("VEHICLE_ITEM", doc.id, true);
    expect(await starred()).toBe(true);
  });

  it("won't restore a Document while its record's parent is in Trash, naming the outermost one", async () => {
    const trip = await createTripCommand({ title: "Japan" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    const tripDoc = await addDocumentCommand("TRIP_SEGMENT", segment.id, { file: pdf() });
    await deleteDocumentCommand("TRIP_SEGMENT", tripDoc.id);
    await deleteTripCommand(trip.id);
    await expect(restoreDocumentCommand("TRIP_SEGMENT", tripDoc.id)).rejects.toThrow("Restore the trip first.");
    expect(await restoreDocumentAction("TRIP_SEGMENT", tripDoc.id)).toEqual({ error: "Restore the trip first." });

    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    const vehicleDoc = await addDocumentCommand("VEHICLE_ITEM", item.id, { file: pdf() });
    await deleteDocumentCommand("VEHICLE_ITEM", vehicleDoc.id);
    await deleteServiceRecordCommand(item.id);
    await deleteVehicleCommand(vehicle.id);
    await expect(restoreDocumentCommand("VEHICLE_ITEM", vehicleDoc.id)).rejects.toThrow("Restore the vehicle first.");
    await restoreVehicleCommand(vehicle.id);
    await expect(restoreDocumentCommand("VEHICLE_ITEM", vehicleDoc.id)).rejects.toThrow(
      "Restore the service record first.",
    );
    await restoreServiceRecordCommand(item.id);
    await restoreDocumentCommand("VEHICLE_ITEM", vehicleDoc.id);

    await restoreTripCommand(trip.id);
    await restoreDocumentCommand("TRIP_SEGMENT", tripDoc.id);
    expect((await db.prisma.tripSegmentDocument.findUniqueOrThrow({ where: { id: tripDoc.id } })).deletedAt).toBeNull();
    expect(
      (await db.prisma.vehicleItemDocument.findUniqueOrThrow({ where: { id: vehicleDoc.id } })).deletedAt,
    ).toBeNull();
  });
});

// A queue of offline edits replayed through /api/sync after the parent was
// trashed on another device: each op fails with the command's message, and
// nothing is written.
describe("sync replay under a trashed parent", () => {
  async function replay(operations: object[]) {
    const { POST } = await import("@/app/api/sync/route");
    const body = new FormData();
    body.append("operations", JSON.stringify(operations));
    const response = await POST(new NextRequest("http://localhost/api/sync", { method: "POST", body }));
    return (await response.json()) as { results: { id: string; success: boolean; error?: string }[] };
  }

  it("reports creates and updates under a trashed Vehicle, Trip or Property as failed", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    const trip = await createTripCommand({ title: "Japan" }, actorId);
    const segment = await createTripSegmentCommand(trip.id, flight);
    const property = await createPropertyCommand(propertySchema.parse({ label: "House" }), actorId);
    const homeItem = await createMaintenanceRecordCommand(property.id, maintenance());
    await deleteVehicleCommand(vehicle.id);
    await deleteTripCommand(trip.id);
    await deletePropertyCommand(property.id);

    const { results } = await replay([
      { id: "op-1", entity: "vehicleItem", operation: "create", parentId: vehicle.id, formValues: { type: "SERVICE", title: "Offline", currency: "AUD" } },
      { id: "op-2", entity: "vehicleItem", operation: "update", parentId: vehicle.id, entityId: item.id, formValues: { type: "SERVICE", title: "Edited", currency: "AUD" } },
      { id: "op-3", entity: "vehicle", operation: "update", entityId: vehicle.id, formValues: { label: "Renamed" } },
      { id: "op-4", entity: "tripSegment", operation: "create", parentId: trip.id, formValues: { type: "FLIGHT", title: "Offline", currency: "AUD" } },
      { id: "op-5", entity: "tripSegment", operation: "update", parentId: trip.id, entityId: segment.id, formValues: { type: "FLIGHT", title: "Edited", currency: "AUD" } },
      { id: "op-6", entity: "trip", operation: "update", entityId: trip.id, formValues: { title: "Renamed" } },
      { id: "op-7", entity: "homeItem", operation: "create", parentId: property.id, formValues: { type: "MAINTENANCE", title: "Offline" } },
      { id: "op-8", entity: "homeItem", operation: "update", parentId: property.id, entityId: homeItem.id, formValues: { type: "MAINTENANCE", title: "Edited" } },
    ]);

    expect(results).toEqual([
      { id: "op-1", success: false, error: "Vehicle not found" },
      { id: "op-2", success: false, error: "Service record not found" },
      { id: "op-3", success: false, error: "Vehicle not found" },
      { id: "op-4", success: false, error: "Trip not found" },
      { id: "op-5", success: false, error: "Segment not found" },
      { id: "op-6", success: false, error: "Trip not found" },
      { id: "op-7", success: false, error: "Property not found" },
      { id: "op-8", success: false, error: "Maintenance record not found" },
    ]);
    expect(await db.prisma.vehicleItem.count()).toBe(1);
    expect(await db.prisma.tripSegment.count()).toBe(1);
    expect(await db.prisma.homeItem.count()).toBe(1);
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(service.title);

    // Once the parents are restored, the same edits go through.
    await restoreVehicleCommand(vehicle.id);
    await restoreTripCommand(trip.id);
    await restorePropertyCommand(property.id);
    const retried = await replay([
      { id: "op-9", entity: "vehicleItem", operation: "create", parentId: vehicle.id, formValues: { type: "SERVICE", title: "Offline", currency: "AUD" } },
      { id: "op-10", entity: "tripSegment", operation: "create", parentId: trip.id, formValues: { type: "FLIGHT", title: "Offline", currency: "AUD" } },
      { id: "op-11", entity: "homeItem", operation: "create", parentId: property.id, formValues: { type: "MAINTENANCE", title: "Offline" } },
    ]);
    expect(retried.results.every((r) => r.success)).toBe(true);
    expect(await db.prisma.vehicleItem.count()).toBe(2);
  });
});

// The Trash check and the write can't be split by another request moving
// the parent to Trash in between: an update's guarded write carries the
// rule itself, and a Document insert checks and writes in one transaction.
describe("a parent moved to Trash during the write", () => {
  it("refuses a Service record update whose Vehicle is trashed just before the write", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    const delegate = db.prisma.vehicleItem;
    const updateMany = delegate.updateMany.bind(delegate);
    const spy = vi.spyOn(delegate, "updateMany").mockImplementationOnce((async (args: Parameters<typeof updateMany>[0]) => {
      await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { deletedAt: new Date() } });
      return updateMany(args);
    }) as never);

    await expect(
      updateServiceRecordCommand(item.id, { title: "Late" }, { baseUpdatedAt: item.updatedAt }),
    ).rejects.toThrow("Service record not found");
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await db.prisma.vehicleItem.findUniqueOrThrow({ where: { id: item.id } })).title).toBe(service.title);
  });

  it("refuses a Trip update when the Trip is trashed just before the write", async () => {
    const trip = await createTripCommand({ title: "Japan" }, actorId);
    const delegate = db.prisma.trip;
    const updateMany = delegate.updateMany.bind(delegate);
    vi.spyOn(delegate, "updateMany").mockImplementationOnce((async (args: Parameters<typeof updateMany>[0]) => {
      await db.prisma.trip.update({ where: { id: trip.id }, data: { deletedAt: new Date() } });
      return updateMany(args);
    }) as never);

    await expect(updateTripCommand(trip.id, { destination: "Tokyo" }, actorId)).rejects.toThrow("Trip not found");
    expect((await db.prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).destination).toBeNull();
  });

  it("refuses a Document whose record is trashed while its file is saved, and removes the file", async () => {
    const vehicle = await createVehicleCommand({ label: "Car" }, actorId);
    const item = await createServiceRecordCommand(vehicle.id, service);
    const store = documentStoreFor("VEHICLE_ITEM");
    const save = store.save.bind(store);
    vi.spyOn(store, "save").mockImplementationOnce(async (ownerId, file) => {
      const saved = await save(ownerId, file);
      await db.prisma.vehicle.update({ where: { id: vehicle.id }, data: { deletedAt: new Date() } });
      return saved;
    });
    const remove = vi.spyOn(store, "remove");

    await expect(addDocumentCommand("VEHICLE_ITEM", item.id, { file: pdf() })).rejects.toThrow(
      "Service record not found",
    );
    expect(await db.prisma.vehicleItemDocument.count()).toBe(0);
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockRestore();
  });

  it("still updates a Tenancy with an empty patch", async () => {
    const property = await createPropertyCommand(propertySchema.parse({ label: "Flat" }), actorId);
    const tenancy = await createTenancyCommand(property.id, { tenantName: "Sam", weeklyRent: 500, currency: "AUD" }, actorId);
    await expect(updateTenancyCommand(tenancy.id, {})).resolves.toMatchObject({ id: tenancy.id });
  });
});
