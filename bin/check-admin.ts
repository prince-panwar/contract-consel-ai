/**
 * Diagnostic: confirms the admin env is loaded correctly without printing it.
 * Usage:
 *   npm run check-admin '<the password you typed in the login form>'
 */
import { loadEnvConfig } from "@next/env";
import bcrypt from "bcryptjs";
import path from "path";

function decodeHash(raw: string): { hash: string | null; format: string } {
  if (/^\$2[aby]\$\d{1,2}\$/.test(raw)) {
    return { hash: raw, format: "raw bcrypt (works only if dotenv didn't eat any $)" };
  }
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (/^\$2[aby]\$\d{1,2}\$/.test(decoded) && decoded.length === 60) {
      return { hash: decoded, format: "base64-encoded bcrypt (recommended)" };
    }
  } catch {
    /* ignore */
  }
  return { hash: null, format: "unrecognized" };
}

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npm run check-admin '<password>'");
    process.exit(1);
  }

  loadEnvConfig(path.resolve(process.cwd()));

  const email = process.env.ADMIN_EMAIL;
  const raw = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;

  console.log("ADMIN_EMAIL set:           ", Boolean(email));
  console.log("ADMIN_PASSWORD_HASH set:   ", Boolean(raw));
  console.log("SESSION_SECRET set:        ", Boolean(secret));

  if (raw) {
    const { hash, format } = decodeHash(raw);
    console.log("Hash format detected:      ", format);
    if (hash) {
      console.log("Decoded hash length:       ", hash.length, "(expected 60)");
    } else {
      console.log("Raw value length:          ", raw.length);
      console.log("Raw value preview:         ", JSON.stringify(raw.slice(0, 8) + "…"));
      console.log(
        "  → Re-run: npm run hash-password '<your-password>' and paste the new line.",
      );
      process.exit(1);
    }

    if (secret) {
      console.log("SESSION_SECRET length:     ", secret.length, "(must be ≥ 32)");
    }

    if (email) {
      const ok = await bcrypt.compare(password, hash);
      console.log("");
      console.log("bcrypt.compare(password, hash):", ok ? "✓ MATCH" : "✗ NO MATCH");
      if (!ok) {
        console.log(
          "  → The password you just typed differs from what you hashed. Re-hash with the right password.",
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
