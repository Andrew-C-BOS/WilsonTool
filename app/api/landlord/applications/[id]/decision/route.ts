// app/api/landlord/applications/[id]/decision/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type AppStatus =
  | "new"
  | "in_review"
  | "needs_approval"
  | "approved_pending_lease"
  | "rejected";

function mapActionToStatus(action: string): AppStatus | null {
  const a = String(action || "").toLowerCase();
  if (a === "preliminary_accept") return "needs_approval";
  if (a === "approve" || a === "fully_accept") return "approved_pending_lease";
  if (a === "reject") return "rejected";
  return null;
}

/* ----- Prisma ----- */
async function updateViaPrisma(id: string, status: AppStatus) {
  try {
    const mod = await import("@prisma/client").catch(() => null);
    if (!mod?.PrismaClient) return false;
    const prisma = new mod.PrismaClient();

    const candidates = [
      "householdApplication",
      "applicationGroup",
      "application",
      "tenantApplication",
    ];
    const data = {
      status,
      workflowStatus: status,
      state: status,
      phase: status,
    } as any;

    for (const name of candidates) {
      // @ts-ignore
      const model = (prisma as any)[name];
      if (!model?.updateMany) continue;
      try {
        const r = await model.updateMany({ where: { id }, data });
        if (r?.count > 0) {
          await prisma.$disconnect().catch(() => {});
          return true;
        }
      } catch {}
      try {
        const r2 = await model.updateMany({ where: { _id: id } as any, data });
        if (r2?.count > 0) {
          await prisma.$disconnect().catch(() => {});
          return true;
        }
      } catch {}
    }

    await prisma.$disconnect().catch(() => {});
  } catch {}
  return false;
}

/* ----- Mongoose ----- */
async function updateViaMongoose(id: string, status: AppStatus) {
  try {
    const mongoose = await import("mongoose").catch(() => null);
    if (!mongoose) return false;

    const modelNames = [
      "HouseholdApplication",
      "ApplicationGroup",
      "Application",
      "TenantApplication",
    ];
    for (const n of modelNames) {
      let Model: any = null;
      try {
        Model = mongoose.model(n);
      } catch {}
      if (!Model) continue;

      try {
        const r = await Model.updateOne(
          { _id: id },
          { $set: { status, workflowStatus: status, state: status, phase: status } }
        );
        if (r?.modifiedCount > 0 || r?.matchedCount > 0) return true;
      } catch {}
      try {
        const r2 = await Model.updateOne(
          { id },
          { $set: { status, workflowStatus: status, state: status, phase: status } }
        );
        if (r2?.modifiedCount > 0 || r2?.matchedCount > 0) return true;
      } catch {}
    }
  } catch {}
  return false;
}

/* ----- Raw collections (optional) ----- */
async function updateViaCollections(id: string, status: AppStatus) {
  const paths = ["@/app/api/collections", "@/lib/collections", "@/collections"];
  for (const p of paths) {
    try {
      const mod: any = await import(p);
      const candidates = [
        "applications",
        "applicationGroups",
        "householdApplications",
        "tenantApplications",
      ];
      for (const name of candidates) {
        const col = mod?.[name] ?? mod?.default?.[name];
        if (col?.updateOne) {
          const data = {
            $set: { status, workflowStatus: status, state: status, phase: status },
          };
          const r1 = await col.updateOne({ _id: id }, data);
          if (r1?.modifiedCount > 0 || r1?.matchedCount > 0) return true;
          const r2 = await col.updateOne({ id }, data);
          if (r2?.modifiedCount > 0 || r2?.matchedCount > 0) return true;
        }
      }
    } catch {}
  }
  return false;
}

// ✅ Use RouteContext, await params
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/landlord/applications/[id]/decision">
) {
  const { id } = await ctx.params;

  const body = await req.json().catch(() => ({}));
  const status = mapActionToStatus(body?.action);
  if (!status) {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  const ok =
    (await updateViaPrisma(id, status)) ||
    (await updateViaMongoose(id, status)) ||
    (await updateViaCollections(id, status));

  if (!ok) return NextResponse.json({ ok: false, error: "not_updated" }, { status: 501 });
  return NextResponse.json({ ok: true, status });
}
