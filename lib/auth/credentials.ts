import bcrypt from "bcryptjs";

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<boolean> {
  const expectedEmail = process.env.ADMIN_EMAIL;
  const expectedHash = process.env.ADMIN_PASSWORD_HASH;
  if (!expectedEmail || !expectedHash) {
    throw new Error(
      "ADMIN_EMAIL or ADMIN_PASSWORD_HASH not set. See .env.local.example.",
    );
  }
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
