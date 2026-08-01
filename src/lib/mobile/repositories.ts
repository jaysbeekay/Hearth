import type { ModuleKey } from "@/lib/modules/registry";
import type {
  MobileContractDto,
  MobileContractInput,
  MobileDashboardSummaryDto,
  MobileDocumentDto,
  MobileDocumentOwnerType,
  MobileModuleSettingDto,
  MobileProductDto,
  MobileProductInput,
  MobileRecordId,
  MobileServerCompatibilityDto,
  MobileVehicleDto,
  MobileVehicleInput,
  MobileVehicleItemDto,
  MobileVehicleItemInput,
  ProductDocumentKind,
} from "@/lib/mobile/dtos";

export interface MobileListOptions {
  search?: string;
  limit?: number;
  cursor?: string;
}

export interface MobileListResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MobileMutationOptions {
  expectedVersion?: number | string;
  idempotencyKey?: string;
}

export interface MobileAttachmentInput {
  ownerType: MobileDocumentOwnerType;
  ownerId: MobileRecordId;
  filename: string;
  mimeType: string;
  size: number;
  kind?: ProductDocumentKind | null;
  fileUri?: string;
  blob?: Blob;
}

export interface ContractsRepository {
  list(
    options?: MobileListOptions,
  ): Promise<MobileListResult<MobileContractDto>>;
  get(id: MobileRecordId): Promise<MobileContractDto | null>;
  create(
    input: MobileContractInput,
    options?: MobileMutationOptions,
  ): Promise<MobileContractDto>;
  update(
    id: MobileRecordId,
    input: MobileContractInput,
    options?: MobileMutationOptions,
  ): Promise<MobileContractDto>;
  remove(id: MobileRecordId, options?: MobileMutationOptions): Promise<void>;
}

export interface ProductsRepository {
  list(
    options?: MobileListOptions,
  ): Promise<MobileListResult<MobileProductDto>>;
  get(id: MobileRecordId): Promise<MobileProductDto | null>;
  create(
    input: MobileProductInput,
    options?: MobileMutationOptions,
  ): Promise<MobileProductDto>;
  update(
    id: MobileRecordId,
    input: MobileProductInput,
    options?: MobileMutationOptions,
  ): Promise<MobileProductDto>;
  remove(id: MobileRecordId, options?: MobileMutationOptions): Promise<void>;
}

export interface DocumentsRepository {
  listForOwner(
    ownerType: MobileDocumentOwnerType,
    ownerId: MobileRecordId,
  ): Promise<MobileDocumentDto[]>;
  get(id: MobileRecordId): Promise<MobileDocumentDto | null>;
  attach(
    input: MobileAttachmentInput,
    options?: MobileMutationOptions,
  ): Promise<MobileDocumentDto>;
  remove(id: MobileRecordId, options?: MobileMutationOptions): Promise<void>;
}

export interface ModuleSettingsRepository {
  list(): Promise<MobileModuleSettingDto[]>;
  setEnabled(key: ModuleKey, enabled: boolean): Promise<MobileModuleSettingDto>;
}

export interface DashboardRepository {
  getSummary(): Promise<MobileDashboardSummaryDto>;
}

export interface VehiclesRepository {
  list(
    options?: MobileListOptions,
  ): Promise<MobileListResult<MobileVehicleDto>>;
  get(id: MobileRecordId): Promise<MobileVehicleDto | null>;
  create(
    input: MobileVehicleInput,
    options?: MobileMutationOptions,
  ): Promise<MobileVehicleDto>;
  update(
    id: MobileRecordId,
    input: MobileVehicleInput,
    options?: MobileMutationOptions,
  ): Promise<MobileVehicleDto>;
  remove(id: MobileRecordId, options?: MobileMutationOptions): Promise<void>;
  listItems(vehicleId: MobileRecordId): Promise<MobileVehicleItemDto[]>;
  createItem(
    vehicleId: MobileRecordId,
    input: MobileVehicleItemInput,
    options?: MobileMutationOptions,
  ): Promise<MobileVehicleItemDto>;
  updateItem(
    vehicleId: MobileRecordId,
    itemId: MobileRecordId,
    input: MobileVehicleItemInput,
    options?: MobileMutationOptions,
  ): Promise<MobileVehicleItemDto>;
  removeItem(
    vehicleId: MobileRecordId,
    itemId: MobileRecordId,
    options?: MobileMutationOptions,
  ): Promise<void>;
}

export interface MobileRepositories {
  serverCompatibility?: () => Promise<MobileServerCompatibilityDto>;
  contracts: ContractsRepository;
  products: ProductsRepository;
  documents: DocumentsRepository;
  modules: ModuleSettingsRepository;
  dashboard: DashboardRepository;
  vehicles?: VehiclesRepository;
}
