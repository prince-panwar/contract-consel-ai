import bcrypt from "bcryptjs";

/**
 * Decode the admin password hash from the env. The hash is stored
 * base64-encoded so it survives Next.js' env-loader variable expansion
 * (which would otherwise eat the `$2a$`/`$2b$` markers in a raw bcrypt
 * hash, even inside single quotes).
 */
function readAdminHash(): string {
  const raw = process.env.ADMIN_PASSWORD_HASH;
  if (!raw) {
    throw new Error(
      "ADMIN_PASSWORD_HASH not set. Run: npm run hash-password '<password>' and paste the result into .env.local.",
    );
  }
  // Detect whether the env contains a raw bcrypt hash or our base64 form.
  if (/^\$2[aby]\$\d{1,2}\$/.test(raw)) {
    return raw;
  }
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    if (/^\$2[aby]\$\d{1,2}\$/.test(decoded) && decoded.length === 60) {
      return decoded;
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    "ADMIN_PASSWORD_HASH does not look like a valid bcrypt hash. Re-run `npm run hash-password '<password>'` and paste the new line into .env.local, then restart the dev server.",
  );
}

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  const expectedEmail = process.env.ADMIN_EMAIL;
  if (!expectedEmail) {
    throw new Error("ADMIN_EMAIL not set. See .env.local.example.");
  }
  const expectedHash = readAdminHash();
  if (email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) {
    // Still run bcrypt to keep timing roughly constant.
    await bcrypt.compare(password, expectedHash);
    return false;
  }
  return bcrypt.compare(password, expectedHash);
}

export function getAdminEmail(): string {
  return process.env.ADMIN_EMAIL ?? "";
}
