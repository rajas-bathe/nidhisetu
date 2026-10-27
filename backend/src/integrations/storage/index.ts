import { config } from "../../config/env.js";
import { createLocalFileStorage } from "./localFileStorage.js";
import { createS3Storage } from "./s3Storage.js";
import type { StorageAdapter } from "./types.js";

export * from "./keys.js";
export { StorageConfigError, type StorageAdapter } from "./types.js";

let adapter: StorageAdapter | null = null;

/**
 * Resolves the configured storage driver once per process. STORAGE_DRIVER=local
 * fits development and 'stage' environments that have no bucket credentials
 * yet; the adapter's directory is private, git-ignored and only ever reaches
 * users through the authorized download route.
 */
export function getStorageAdapter(): StorageAdapter {
  adapter ??= config.storage.driver === "s3" ? createS3Storage() : createLocalFileStorage();
  return adapter;
}
