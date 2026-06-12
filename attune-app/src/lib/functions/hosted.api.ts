import { invoke } from "@tauri-apps/api/core";
import { safeLocalStorage } from "../storage";
import { STORAGE_KEYS } from "@/config";

export async function shouldUseHostedAPI(): Promise<boolean> {
  try {
    const hostedApiEnabled =
      safeLocalStorage.getItem(STORAGE_KEYS.HOSTED_API_ENABLED) === "true";
    if (!hostedApiEnabled) return false;

    const hasLicense = await invoke<boolean>("check_license_status");
    return hasLicense;
  } catch (error) {
    console.warn("Failed to check hosted API availability:", error);
    return false;
  }
}
