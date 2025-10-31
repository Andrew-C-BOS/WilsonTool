import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  // TODO: validate and persist
  return NextResponse.json({ ok: true, received: !!body });
}
