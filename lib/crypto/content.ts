import crypto from "node:crypto";

// Application-level encryption for contract content stored in MongoDB
// (PDFs, page/passage text, findings, filenames). AES-256-GCM with a random
// 96-bit IV per value. Protects data at rest in Atlas and its backups; the
// key lives only on the app host (CONTENT_ENCRYPTION_KEY, 32 bytes base64).
// The same format is implemented in services/embed-server/src/crypto.ts.
//
// Values written before encryption was enabled are plain text and are read
// back unchanged, so encryption can be switched on without a migration.

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

let cachedKey: Buffer | null | undefined;

function key(): Buffer | null {
  if (cachedKey !== undefined) return cachedKey;
  const raw = process.env.CONTENT_ENCRYPTION_KEY;
  if (!raw) {
    console.warn("[crypto] CONTENT_ENCRYPTION_KEY not set; contract data is stored unencrypted.");
    cachedKey = null;
    return null;
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("CONTENT_ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  cachedKey = buf;
  return buf;
}

export function encryptionEnabled(): boolean {
  return key() !== null;
}

export function encryptBuffer(plain: Buffer): { data: Buffer; encrypted: boolean } {
  const k = key();
  if (!k) return { data: plain, encrypted: false };
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data: Buffer.concat([iv, cipher.getAuthTag(), body]), encrypted: true };
}

export function decryptBuffer(data: Buffer): Buffer {
  const k = key();
  if (!k) throw new Error("Encrypted data found but CONTENT_ENCRYPTION_KEY is not set.");
  const iv = data.subarray(0, IV_BYTES);
  const tag = data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export function encryptText(plain: string): string {
  const { data, encrypted } = encryptBuffer(Buffer.from(plain, "utf8"));
  return encrypted ? PREFIX + data.toString("base64") : plain;
}

export function decryptText(value: string): string {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value;
  return decryptBuffer(Buffer.from(value.slice(PREFIX.length), "base64")).toString("utf8");
}

export function isEncryptedText(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}
