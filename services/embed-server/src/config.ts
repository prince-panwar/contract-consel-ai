import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v || v === "replace-me") {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

export const config = {
  port: intEnv("PORT", 3000),
  apiKey: required("API_KEY"),
  maxConcurrency: intEnv("MAX_CONCURRENCY", 2),
  maxUploadBytes: intEnv("MAX_UPLOAD_BYTES", 40 * 1024 * 1024),
  modelId: process.env.MODEL_ID || "Xenova/all-MiniLM-L6-v2",
};
