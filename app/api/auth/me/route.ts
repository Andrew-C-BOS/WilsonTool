import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, user: null }, { status: 401 });
  return NextResponse.json({ ok: true, user });
}
