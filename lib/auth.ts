// lib/auth.ts
import * as bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb } from "./db";

const COOKIE = "milo_auth";
const ALG = "HS256";

// 👇 Add "admin" to your app-level roles
export type Role = "tenant" | "landlord" | "admin";

export type SessionUser = {
  _id: string;
  email: string;
  role: Role;
  isAdmin: boolean; // derived from role === "admin" or DB flag/allow-list
};

// Optional allow-list for bootstrap
const ADMIN_EMAILS: string[] = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function key() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
}

/* ---------------- DB helpers ---------------- */

export async function findUserByEmail(email: string) {
  const db = await getDb();
  return db
    .collection("users")
    .findOne<{ _id: any; email: string; passwordHash: string; role: Role; isAdmin?: boolean }>({ email });
}

export async function createUser(
  email: string,
  password: string,
  role: Role,
  legalName?: string
) {
  const db = await getDb();

  if (await db.collection("users").findOne({ email })) {
    throw new Error("Email already in use");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // If role is explicitly "admin", that implies admin; otherwise allow-list can still grant admin
  const isAdmin = role === "admin" || ADMIN_EMAILS.includes(email.toLowerCase());

  const doc: any = {
    email,
    passwordHash,
    role,
    isAdmin,
    createdAt: new Date(),
  };

  // For tenants, persist the legal name your deposit flows need
  if (role === "tenant" && legalName) {
    doc.legal_name = legalName; // ← snake_case as requested
  }

  const res = await db.collection("users").insertOne(doc);

  // You can extend SessionUser later if you want legal_name on the session;
  // for now we keep the existing return shape.
  return { _id: String(res.insertedId), email, role, isAdmin } as SessionUser;
}

/* ---------------- Crypto ---------------- */

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/* ---------------- Admin derivation ---------------- */

function computeIsAdmin(input: { email?: string; role?: Role; isAdmin?: boolean } | null) {
  if (!input) return false;
  if (input.role === "admin") return true;                           // <- main switch
  if (input.isAdmin === true) return true;                           // DB flag
  if (input.email && ADMIN_EMAILS.includes(input.email.toLowerCase())) return true; // allow-list
  return false;
}

/* ---------------- Session (JWT in cookie) ---------------- */

type SessionInput = { _id: string; email: string; role: Role; isAdmin?: boolean };

export async function createSession(user: SessionInput) {
  // Always recompute isAdmin from role/DB/allow-list to avoid stale tokens
  let isAdmin = computeIsAdmin(user);
  if (!isAdmin) {
    const doc = await findUserByEmail(user.email);
    isAdmin = computeIsAdmin({ email: user.email, role: user.role, isAdmin: doc?.isAdmin });
  }

  const payload: SessionUser = {
    _id: String(user._id),
    email: user.email,
    role: user.role,
    isAdmin,
  };

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());

  const store = await cookies();
  store.set({
    name: COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.set({
    name: COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    const u = payload as any;

    // Re-derive admin on every read so old tokens upgrade automatically
    let isAdmin = computeIsAdmin({ email: u.email, role: u.role, isAdmin: u.isAdmin });
    if (!isAdmin && u?.email) {
      const doc = await findUserByEmail(String(u.email));
      isAdmin = computeIsAdmin({ email: u.email, role: u.role as Role, isAdmin: doc?.isAdmin });
    }

    return {
      _id: String(u._id),
      email: String(u.email),
      role: u.role as Role,
      isAdmin,
    };
  } catch {
    return null;
  }
}

/* ---------------- Tiny helpers ---------------- */

export function isAppAdmin(u: SessionUser | null | undefined): u is SessionUser & { isAdmin: true } {
  return !!u?.isAdmin;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u || !u.isAdmin) throw new Error("FORBIDDEN_ADMIN");
  return u;
}
