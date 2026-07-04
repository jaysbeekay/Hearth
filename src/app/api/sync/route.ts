import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { vehicleSchema, vehicleItemSchema } from "@/lib/validation/vehicles";
import { contractSchema } from "@/lib/validation/contract";
import { productSchema } from "@/lib/validation/product";
import { isModuleEnabled } from "@/lib/modules/enablement";

interface SyncOperation {
  id: string;
  entity: string;
  operation: "create" | "update" | "delete";
  entityId?: string;
  parentId?: string;  // parent record ID (e.g. vehicleId for vehicleItem)
  formValues: Record<string, string>;
}

interface SyncResult {
  id: string;
  success: boolean;
  error?: string;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { operations: SyncOperation[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body?.operations)) {
    return NextResponse.json({ error: "operations must be an array" }, { status: 400 });
  }

  const results: SyncResult[] = [];

  for (const op of body.operations) {
    try {
      await processOperation(op, session.user.id);
      results.push({ id: op.id, success: true });
    } catch (err) {
      results.push({
        id: op.id,
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({ results });
}

async function processOperation(op: SyncOperation, userId: string): Promise<void> {
  switch (op.entity) {
    case "vehicle":
      return processVehicle(op, userId);
    case "vehicleItem":
      return processVehicleItem(op, userId);
    case "contract":
      return processContract(op, userId);
    case "product":
      return processProduct(op, userId);
    default:
      throw new Error(`Unsupported entity: ${op.entity}`);
  }
}

// ─── Vehicles ────────────────────────────────────────────────────────────────

async function processVehicle(op: SyncOperation, userId: string): Promise<void> {
  if (!(await isModuleEnabled("VEHICLES"))) throw new Error("Vehicles module is disabled");

  if (op.operation === "create") {
    const parsed = vehicleSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.vehicle.create({ data: { ...parsed.data, createdById: userId } });
    revalidatePath("/vehicles");
  } else if (op.operation === "update" && op.entityId) {
    const existing = await prisma.vehicle.findUnique({ where: { id: op.entityId } });
    if (!existing || existing.createdById !== userId) throw new Error("Vehicle not found");
    const parsed = vehicleSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.vehicle.update({ where: { id: op.entityId }, data: parsed.data });
    revalidatePath("/vehicles");
    revalidatePath(`/vehicles/${op.entityId}`);
  }
}

async function processVehicleItem(op: SyncOperation, userId: string): Promise<void> {
  if (!(await isModuleEnabled("VEHICLES"))) throw new Error("Vehicles module is disabled");

  if (op.operation === "create" && op.parentId) {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: op.parentId } });
    if (!vehicle || vehicle.createdById !== userId) throw new Error("Vehicle not found");
    const parsed = vehicleItemSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.vehicleItem.create({ data: { ...parsed.data, vehicleId: op.parentId } });
    revalidatePath(`/vehicles/${op.parentId}`);
  } else if (op.operation === "update" && op.entityId && op.parentId) {
    const item = await prisma.vehicleItem.findUnique({ where: { id: op.entityId } });
    if (!item || item.vehicleId !== op.parentId) throw new Error("Item not found");
    const vehicle = await prisma.vehicle.findUnique({ where: { id: op.parentId } });
    if (!vehicle || vehicle.createdById !== userId) throw new Error("Vehicle not found");
    const parsed = vehicleItemSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.vehicleItem.update({ where: { id: op.entityId }, data: parsed.data });
    revalidatePath(`/vehicles/${op.parentId}`);
  }
}

// ─── Contracts ───────────────────────────────────────────────────────────────

async function processContract(op: SyncOperation, userId: string): Promise<void> {
  if (op.operation === "create") {
    const parsed = contractSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.contract.create({ data: { ...parsed.data, createdById: userId } });
    revalidatePath("/contracts");
  } else if (op.operation === "update" && op.entityId) {
    const existing = await prisma.contract.findUnique({ where: { id: op.entityId } });
    if (!existing || existing.createdById !== userId) throw new Error("Contract not found");
    const parsed = contractSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.contract.update({ where: { id: op.entityId }, data: parsed.data });
    revalidatePath("/contracts");
    revalidatePath(`/contracts/${op.entityId}`);
  }
}

// ─── Products ────────────────────────────────────────────────────────────────

async function processProduct(op: SyncOperation, userId: string): Promise<void> {
  if (op.operation === "create") {
    const parsed = productSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.product.create({ data: { ...parsed.data, createdById: userId } });
    revalidatePath("/products");
  } else if (op.operation === "update" && op.entityId) {
    const existing = await prisma.product.findUnique({ where: { id: op.entityId } });
    if (!existing || existing.createdById !== userId) throw new Error("Product not found");
    const parsed = productSchema.safeParse(op.formValues);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid data");
    await prisma.product.update({ where: { id: op.entityId }, data: parsed.data });
    revalidatePath("/products");
    revalidatePath(`/products/${op.entityId}`);
  }
}
