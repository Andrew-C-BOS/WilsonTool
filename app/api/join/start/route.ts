// app/api/join/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt, randomBytes } from "crypto";
import { getDb } from "@/lib/db";
import { sendMail, renderOtpEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sha256(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function mask(e: string) {
  const [u, d] = String(e).split("@");
  if (!d) return e;
  return `${u.slice(0, 2)}…@${d}`;
}

export async function POST(req: NextRequest) {
  const traceId = randomBytes(8).toString("hex");
  const t0 = Date.now();
  try {
    const { code } = await req.json();
    if (!code) {
      return NextResponse.json({ ok: false, error: "missing_code" }, { status: 400 });
    }

    const db = await getDb();
    const invites = db.collection("household_invites");
    const codeHash = sha256(code);

    const inv = await invites.findOne({ codeHash, state: "active" as const });

    if (!inv) {
      console.error("[join.start]", { traceId, event: "invite_not_found", codeHash });
      return NextResponse.json({ ok: false, error: "invalid_or_used" }, { status: 404 });
    }

    const now = new Date();
    if (inv.expiresAt && new Date(inv.expiresAt) < now) {
      console.warn("[join.start]", { traceId, event: "invite_expired", inviteId: String(inv._id) });
      return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
    }

    if (inv.verifyLastSentAt && now.getTime() - new Date(inv.verifyLastSentAt).getTime() < 30_000) {
      console.info("[join.start]", { traceId, event: "throttled", inviteId: String(inv._id) });
      return NextResponse.json({ ok: false, error: "too_soon" }, { status: 429 });
    }

    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const otpHash = sha256(otp);

    await invites.updateOne(
      { _id: inv._id },
      {
        $set: {
          verifyCodeHash: otpHash,
          verifyExpiresAt: new Date(now.getTime() + 10 * 60_000),
          verifyLastSentAt: now,
          verifyAttempts: 0,
        },
      }
    );

    const to = String(inv.email || "");
    const { subject, text, html } = renderOtpEmail({
      code: otp,
      toDisplay: to,
      brand: "MILO",
      minutes: 10,
    });

    console.log("[join.start] send_attempt", {
      traceId,
      to: mask(to),
      inviteId: String(inv._id),
      region: process.env.AWS_REGION,
      provider: (process.env.MAIL_PROVIDER || "console").toLowerCase(),
      from: process.env.MAIL_FROM,
      usingEmailKeys: !!process.env.AWS_EMAIL_ACCESS_KEY_ID,
    });

    const result = await sendMail({
      to,
      subject,
      text,
      html,
      idempotencyKey: `otp:${inv._id.toString()}:${otpHash}`,
      traceId,
    });

    if (!result.ok) {
      console.error("[join.start] send_failed", {
        traceId,
        to: mask(to),
        error: result.error,
      });
      return NextResponse.json(
        { ok: false, error: "send_failed", traceId },
        { status: 500 }
      );
    }

    console.log("[join.start] send_ok", {
      traceId,
      to: mask(to),
      ms: Date.now() - t0,
    });

    return NextResponse.json({ ok: true, traceId });
  } catch (e: any) {
    console.error("[join.start] error", { traceId, message: e?.message, stack: e?.stack });
    return NextResponse.json({ ok: false, error: "server_error", traceId }, { status: 500 });
  }
}
