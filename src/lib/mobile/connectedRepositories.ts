import type { ModuleKey } from "@/lib/modules/registry";
import type {
  MobileContractDto,
  MobileDashboardSummaryDto,
  MobileDocumentDto,
  MobileModuleSettingDto,
  MobileProductDto,
  MobileRecordId,
  MobileServerCompatibilityDto,
  MobileVehicleDto,
  MobileVehicleInput,
  MobileVehicleItemDto,
  MobileVehicleItemInput,
} from "@/lib/mobile/dtos";
import type {
  MobileAttachmentInput,
  MobileListOptions,
  MobileListResult,
  MobileMutationOptions,
  MobileRepositories,
} from "@/lib/mobile/repositories";

export interface ConnectedRepositoryOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function cleanBaseUrl(baseUrl?: string): string {
  return baseUrl?.replace(/\/+$/, "") ?? "";
}

function withQuery(path: string, options?: MobileListOptions): string {
  const params = new URLSearchParams();
  if (options?.search) params.set("search", options.search);
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.cursor) params.set("cursor", options.cursor);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

function headers(options?: MobileMutationOptions): HeadersInit {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.expectedVersion != null)
    result["If-Match"] = String(options.expectedVersion);
  if (options?.idempotencyKey)
    result["Idempotency-Key"] = options.idempotencyKey;
  return result;
}

export function createConnectedRepositories(
  options: ConnectedRepositoryOptions = {},
): MobileRepositories {
  const baseUrl = cleanBaseUrl(options.baseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}/api/mobile/v1${path}`, {
      credentials: "include",
      ...init,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error ?? `Mobile API request failed (${response.status})`,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async function requestNullable<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T | null> {
    const response = await fetchImpl(`${baseUrl}/api/mobile/v1${path}`, {
      credentials: "include",
      ...init,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(
        body?.error ?? `Mobile API request failed (${response.status})`,
      );
    }
    return (await response.json()) as T;
  }

  return {
    serverCompatibility: () =>
      request<MobileServerCompatibilityDto>("/compatibility"),
    contracts: {
      list: (options) =>
        request<MobileListResult<MobileContractDto>>(
          withQuery("/contracts", options),
        ),
      get: (id) =>
        requestNullable<MobileContractDto>(
          `/contracts/${encodeURIComponent(id)}`,
        ),
      create: (input) =>
        request<MobileContractDto>("/contracts", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(input),
        }),
      update: (id, input, options) =>
        request<MobileContractDto>(`/contracts/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: headers(options),
          body: JSON.stringify(input),
        }),
      remove: (id, options) =>
        request<void>(`/contracts/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: options?.expectedVersion
            ? { "If-Match": String(options.expectedVersion) }
            : undefined,
        }),
    },
    products: {
      list: (options) =>
        request<MobileListResult<MobileProductDto>>(
          withQuery("/products", options),
        ),
      get: (id) =>
        requestNullable<MobileProductDto>(
          `/products/${encodeURIComponent(id)}`,
        ),
      create: (input) =>
        request<MobileProductDto>("/products", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(input),
        }),
      update: (id, input, options) =>
        request<MobileProductDto>(`/products/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: headers(options),
          body: JSON.stringify(input),
        }),
      remove: (id, options) =>
        request<void>(`/products/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: options?.expectedVersion
            ? { "If-Match": String(options.expectedVersion) }
            : undefined,
        }),
    },
    documents: {
      listForOwner: (ownerType, ownerId) =>
        request<{ items: MobileDocumentDto[] }>(
          `/documents?ownerType=${encodeURIComponent(ownerType)}&ownerId=${encodeURIComponent(ownerId)}`,
        ).then((result) => result.items),
      get: (id) =>
        requestNullable<MobileDocumentDto>(
          `/documents/${encodeURIComponent(id)}`,
        ),
      attach: (input: MobileAttachmentInput) => {
        if (!input.blob)
          throw new Error("Connected document uploads require a Blob.");
        const formData = new FormData();
        formData.set("ownerType", input.ownerType);
        formData.set("ownerId", input.ownerId);
        formData.set("kind", input.kind ?? "OTHER");
        formData.set("file", input.blob, input.filename);
        return request<MobileDocumentDto>("/documents", {
          method: "POST",
          body: formData,
        });
      },
      remove: (id) =>
        request<void>(`/documents/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
    },
    modules: {
      list: () =>
        request<{ items: MobileModuleSettingDto[] }>("/modules").then(
          (result) => result.items,
        ),
      setEnabled: (key: ModuleKey, enabled: boolean) =>
        request<MobileModuleSettingDto>("/modules", {
          method: "PATCH",
          headers: headers(),
          body: JSON.stringify({ key, enabled }),
        }),
    },
    dashboard: {
      getSummary: () => request<MobileDashboardSummaryDto>("/dashboard"),
    },
    vehicles: {
      list: (options) =>
        request<MobileListResult<MobileVehicleDto>>(
          withQuery("/vehicles", options),
        ),
      get: (id) =>
        requestNullable<MobileVehicleDto>(
          `/vehicles/${encodeURIComponent(id)}`,
        ),
      create: (input: MobileVehicleInput) =>
        request<MobileVehicleDto>("/vehicles", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify(input),
        }),
      update: (
        id: MobileRecordId,
        input: MobileVehicleInput,
        options?: MobileMutationOptions,
      ) =>
        request<MobileVehicleDto>(`/vehicles/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: headers(options),
          body: JSON.stringify(input),
        }),
      remove: (id: MobileRecordId, options?: MobileMutationOptions) =>
        request<void>(`/vehicles/${encodeURIComponent(id)}`, {
          method: "DELETE",
          headers: options?.expectedVersion
            ? { "If-Match": String(options.expectedVersion) }
            : undefined,
        }),
      listItems: (vehicleId) =>
        request<{ items: MobileVehicleItemDto[] }>(
          `/vehicles/${encodeURIComponent(vehicleId)}/items`,
        ).then((result) => result.items),
      createItem: (vehicleId, input: MobileVehicleItemInput) =>
        request<MobileVehicleItemDto>(
          `/vehicles/${encodeURIComponent(vehicleId)}/items`,
          {
            method: "POST",
            headers: headers(),
            body: JSON.stringify(input),
          },
        ),
      updateItem: (vehicleId, itemId, input, options) =>
        request<MobileVehicleItemDto>(
          `/vehicles/${encodeURIComponent(vehicleId)}/items/${encodeURIComponent(itemId)}`,
          {
            method: "PUT",
            headers: headers(options),
            body: JSON.stringify(input),
          },
        ),
      removeItem: (vehicleId, itemId, options) =>
        request<void>(
          `/vehicles/${encodeURIComponent(vehicleId)}/items/${encodeURIComponent(itemId)}`,
          {
            method: "DELETE",
            headers: options?.expectedVersion
              ? { "If-Match": String(options.expectedVersion) }
              : undefined,
          },
        ),
    },
  };
}
