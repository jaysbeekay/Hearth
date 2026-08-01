import type { MobileRuntimeMode } from "@/lib/mobile/capabilityModel";
import type { MobileRepositories } from "@/lib/mobile/repositories";
import { createConnectedRepositories } from "@/lib/mobile/connectedRepositories";
import { isNativeStandaloneStorageAvailable } from "@/lib/mobile/nativeStandaloneStore";
import { nativeStandaloneRepositories } from "@/lib/mobile/nativeStandaloneRepositories";
import { getStoredRuntimeMode } from "@/lib/mobile/runtime";
import { standaloneRepositories } from "@/lib/mobile/standaloneRepositories";

export function getMobileRepositories(
  mode: MobileRuntimeMode | null = getStoredRuntimeMode(),
  connectedBaseUrl?: string,
): MobileRepositories {
  if (mode === "standalone") {
    return isNativeStandaloneStorageAvailable()
      ? nativeStandaloneRepositories
      : standaloneRepositories;
  }
  if (mode === "connected")
    return createConnectedRepositories({ baseUrl: connectedBaseUrl });
  throw new Error(
    "Choose standalone or connected mode before loading mobile repositories.",
  );
}
