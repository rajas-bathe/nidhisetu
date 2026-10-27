import { config } from "../../config/env.js";
import { assertValidObjectKey } from "./keys.js";
import { StorageConfigError, type StorageAdapter } from "./types.js";

/**
 * S3-compatible object storage adapter (AWS S3 and any S3-compatible provider:
 * MinIO, Cloudflare R2, Wasabi...). Selected only when STORAGE_DRIVER=s3; the
 * AWS SDK dependency is imported lazily so development installs without
 * bucket credentials never pay the cost at start-up.
 *
 * NOTE ON DURABILITY: an unconfigured bucket (missing credentials) must never
 * silently degrade to local temporary storage - this adapter throws instead.
 * Production deployment steps live in docs/deployment.md and require
 * S3_REGION + S3_BUCKET (plus access keys, unless the host supplies them
 * through its native integrations).
 */
export function createS3Storage(): StorageAdapter {
  const { region, bucket, accessKeyId, secretAccessKey, endpoint, forcePathStyle } = config.storage.s3;

  async function loadClient() {
    const missing = [
      ["S3_BUCKET", bucket],
      ["S3_REGION", region],
      ["S3_ACCESS_KEY_ID", accessKeyId],
      ["S3_SECRET_ACCESS_KEY", secretAccessKey],
    ].filter(([, value]) => !value);
    if (missing.length > 0) {
      throw new StorageConfigError(
        `STORAGE_DRIVER=s3 requires ${missing.map(([name]) => name).join(", ")}. Store object bodies in a real bucket; this backend never substitutes local file storage in s3 mode.`,
      );
    }
    // Lazy import keeps the SDK out of local development start-up paths.
    const { S3Client } = await import("@aws-sdk/client-s3");
    return new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /** AWS S3 errors carry `name === "NoSuchKey"` for missing objects. */
  function isNoSuchKey(error: unknown): boolean {
    return error != null && typeof error === "object" && (error as { name?: string }).name === "NoSuchKey";
  }

  return {
    name: "s3",

    async put(object, key) {
      assertValidObjectKey(key);
      const client = await loadClient();
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: object,
          }),
        );
      } catch (error) {
        if (
          error != null &&
          typeof error === "object" &&
          (error as { name?: string }).name === "ConditionNotMet"
        ) {
          throw new Error(`An object is already stored under key ${key}.`) as Error & { status?: number };
        }
        throw error;
      }
      return { key };
    },

    async get(key) {
      assertValidObjectKey(key);
      const client = await loadClient();
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      try {
        const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const bytes = await result.Body?.transformToByteArray();
        if (bytes == null) {
          throw new Error(`S3 object ${key} returned an empty body.`);
        }
        return Buffer.from(bytes);
      } catch (error) {
        if (isNoSuchKey(error)) {
          throw Object.assign(new Error("The requested document does not exist."), { status: 404 });
        }
        throw error;
      }
    },

    async delete(key) {
      assertValidObjectKey(key);
      const client = await loadClient();
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
