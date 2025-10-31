// lib/auth.ts
import * as bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb } from "./db";

const COOKIE = "milo_auth";
const ALG = "HS256";
type Role = "tenant" | "landlord";

export type SessionUser = { _id: string; email: string; role: Role };

function key() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Missing JWT_SECRET");
  return new TextEncoder().encode(s);
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  return db
    .collection("users")
    .findOne<{ _id: any; email: string; passwordHash: string; role: Role }>({ email });
}

export async function createUser(email: string, password: string, role: Role) {
  const db = await getDb();
  if (await db.collection("users").findOne({ email })) throw new Error("Email already in use");
  const passwordHash = await bcrypt.hash(password, 10);
  const res = await db
    .collection("users")
    .insertOne({ email, passwordHash, role, createdAt: new Date() });
  return { _id: String(res.insertedId), email, role } as SessionUser;
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function createSession(user: SessionUser) {
  const token = await new SignJWT(user)
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(key());

  const store = await cookies();           // ⬅️ await now required
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
  const store = await cookies();           // ⬅️ await now required
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
  const store = await cookies();           // ⬅️ await now required
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: [ALG] });
    const u = payload as any;
    return { _id: String(u._id), email: u.email, role: u.role };
  } catch {
    return null;
  }
}
