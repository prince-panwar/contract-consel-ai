import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import type { Collection } from "mongodb";
import { getDb } from "../db/mongo";
import { decryptText, encryptText } from "../crypto/content";

export type Role = "viewer" | "reviewer" | "admin";
export const ROLES: Role[] = ["viewer", "reviewer", "admin"];
const RANK: Record<Role, number> = { viewer: 0, reviewer: 1, admin: 2 };

export function atLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

interface UserDoc {
  uid: string;
  email: string; // lower-case
  name: string;
  role: Role;
  passwordHash: string;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  totpSecret: string | null; // encrypted at rest
  totpPending: string | null; // encrypted; set during setup until confirmed
  totpLastStep: number;
  disabled: boolean;
  // Bumped on password change / disable / 2FA reset: invalidates sessions.
  tokenVersion: number;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface User {
  uid: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  disabled: boolean;
  tokenVersion: number;
  createdAt: number;
  lastLoginAt: number | null;
}

function toUser(d: UserDoc): User {
  return {
    uid: d.uid,
    email: d.email,
    name: d.name,
    role: d.role,
    mustChangePassword: d.mustChangePassword,
    totpEnabled: d.totpEnabled,
    disabled: d.disabled,
    tokenVersion: d.tokenVersion,
    createdAt: d.createdAt,
    lastLoginAt: d.lastLoginAt,
  };
}

const globalForUsers = globalThis as unknown as { __ccUsersReady?: Promise<void> };

async function users() {
  const col = (await getDb()).collection<UserDoc>("users");
  globalForUsers.__ccUsersReady ??= (async () => {
    await col.createIndex({ email: 1 }, { unique: true });
    await col.createIndex({ uid: 1 }, { unique: true });
    await bootstrapAdmin(col);
  })().catch((err) => {
    globalForUsers.__ccUsersReady = undefined;
    throw err;
  });
  await globalForUsers.__ccUsersReady;
  return col;
}

// Old single-admin setups used ADMIN_PASSWORD_HASH (raw bcrypt, or base64 of it).
function readEnvHash(raw: string): string | null {
  if (/^\$2[aby]\$\d{1,2}\$/.test(raw)) return raw;
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  return /^\$2[aby]\$\d{1,2}\$/.test(decoded) && decoded.length === 60 ? decoded : null;
}

/** First run: create the env-configured admin as the first user. */
async function bootstrapAdmin(col: Collection<UserDoc>) {
  if ((await col.estimatedDocumentCount()) > 0) return;
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const hash = process.env.ADMIN_PASSWORD_HASH ? readEnvHash(process.env.ADMIN_PASSWORD_HASH) : null;
  if (!email || !hash) return;
  await col
    .insertOne({
      uid: nanoid(12),
      email,
      name: "Administrator",
      role: "admin",
      passwordHash: hash,
      mustChangePassword: false,
      totpEnabled: false,
      totpSecret: null,
      totpPending: null,
      totpLastStep: 0,
      disabled: false,
      tokenVersion: 0,
      createdAt: Date.now(),
      lastLoginAt: null,
    })
    .catch(() => {}); // another process won the race
  console.log(`[auth] bootstrapped admin user ${email} from env`);
}

// Constant-time-ish failure path when the email is unknown.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

export async function verifyPassword(email: string, password: string): Promise<User | null> {
  const col = await users();
  const doc = await col.findOne({ email: email.trim().toLowerCase() });
  const ok = await bcrypt.compare(password, doc?.passwordHash ?? DUMMY_HASH);
  if (!doc || !ok || doc.disabled) return null;
  return toUser(doc);
}

export async function getUser(uid: string): Promise<User | null> {
  const doc = await (await users()).findOne({ uid });
  return doc ? toUser(doc) : null;
}

export async function listUsers(): Promise<User[]> {
  const docs = await (await users()).find({}).sort({ createdAt: 1 }).toArray();
  return docs.map(toUser);
}

export async function recordLogin(uid: string): Promise<void> {
  await (await users()).updateOne({ uid }, { $set: { lastLoginAt: Date.now() } });
}

export function generatePassword(): string {
  return crypto.randomBytes(12).toString("base64url");
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 12) return "Password must be at least 12 characters.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Password must contain letters and numbers.";
  return null;
}

export async function createUser(input: { email: string; name: string; role: Role }): Promise<{ user: User; password: string }> {
  const col = await users();
  const password = generatePassword();
  const doc: UserDoc = {
    uid: nanoid(12),
    email: input.email.trim().toLowerCase(),
    name: input.name.trim() || input.email.trim(),
    role: input.role,
    passwordHash: await bcrypt.hash(password, 12),
    mustChangePassword: true,
    totpEnabled: false,
    totpSecret: null,
    totpPending: null,
    totpLastStep: 0,
    disabled: false,
    tokenVersion: 0,
    createdAt: Date.now(),
    lastLoginAt: null,
  };
  await col.insertOne(doc);
  return { user: toUser(doc), password };
}

async function activeAdminCount(): Promise<number> {
  return (await users()).countDocuments({ role: "admin", disabled: false });
}

export async function updateUser(
  uid: string,
  patch: { role?: Role; disabled?: boolean; name?: string },
): Promise<User | null> {
  const col = await users();
  const current = await col.findOne({ uid });
  if (!current) return null;
  const losingAdmin =
    current.role === "admin" &&
    !current.disabled &&
    ((patch.role && patch.role !== "admin") || patch.disabled === true);
  if (losingAdmin && (await activeAdminCount()) <= 1) {
    throw new Error("At least one active admin is required.");
  }
  const set: Partial<UserDoc> = {};
  if (patch.role) set.role = patch.role;
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.disabled !== undefined) set.disabled = patch.disabled;
  const inc = patch.disabled === true || (patch.role && patch.role !== current.role) ? { tokenVersion: 1 } : undefined;
  const doc = await col.findOneAndUpdate(
    { uid },
    { $set: set, ...(inc ? { $inc: inc } : {}) },
    { returnDocument: "after" },
  );
  return doc ? toUser(doc) : null;
}

export async function resetPassword(uid: string): Promise<string | null> {
  const password = generatePassword();
  const res = await (await users()).updateOne(
    { uid },
    {
      $set: { passwordHash: await bcrypt.hash(password, 12), mustChangePassword: true },
      $inc: { tokenVersion: 1 },
    },
  );
  return res.matchedCount ? password : null;
}

export async function changePassword(uid: string, current: string, next: string): Promise<User> {
  const col = await users();
  const doc = await col.findOne({ uid });
  if (!doc || !(await bcrypt.compare(current, doc.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }
  const problem = passwordProblem(next);
  if (problem) throw new Error(problem);
  if (await bcrypt.compare(next, doc.passwordHash)) throw new Error("Choose a new password.");
  const updated = await col.findOneAndUpdate(
    { uid },
    { $set: { passwordHash: await bcrypt.hash(next, 12), mustChangePassword: false }, $inc: { tokenVersion: 1 } },
    { returnDocument: "after" },
  );
  return toUser(updated!);
}

// ---- 2FA storage (verification lives in totp.ts)

export async function setPendingTotp(uid: string, secret: string): Promise<void> {
  await (await users()).updateOne({ uid }, { $set: { totpPending: encryptText(secret) } });
}

export async function getTotpSecrets(uid: string): Promise<{ active: string | null; pending: string | null; lastStep: number }> {
  const doc = await (await users()).findOne({ uid });
  return {
    active: doc?.totpSecret ? decryptText(doc.totpSecret) : null,
    pending: doc?.totpPending ? decryptText(doc.totpPending) : null,
    lastStep: doc?.totpLastStep ?? 0,
  };
}

/** Atomically record a used TOTP step; false if it (or a later one) was already used. */
export async function consumeTotpStep(uid: string, step: number): Promise<boolean> {
  const res = await (await users()).updateOne(
    { uid, totpLastStep: { $lt: step } },
    { $set: { totpLastStep: step } },
  );
  return res.modifiedCount === 1;
}

export async function enableTotp(uid: string): Promise<void> {
  const col = await users();
  const doc = await col.findOne({ uid });
  if (!doc?.totpPending) throw new Error("Start 2FA setup first.");
  await col.updateOne(
    { uid },
    { $set: { totpSecret: doc.totpPending, totpPending: null, totpEnabled: true }, $inc: { tokenVersion: 1 } },
  );
}

export async function disableTotp(uid: string): Promise<void> {
  await (await users()).updateOne(
    { uid },
    { $set: { totpSecret: null, totpPending: null, totpEnabled: false, totpLastStep: 0 }, $inc: { tokenVersion: 1 } },
  );
}
