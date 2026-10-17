/**
 * GET/POST /api/health — port of routes/healthRoutes.js (HealthProfile CRUD).
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
// MR-1 central fix (2026-10-01): getAuthUser → requireSelf (state + tokenVersion)
// and 500s no longer leak raw error text.
import { requireSelf } from "@/lib/server/jwt";
import { serializeHealthProfile } from "@/lib/server/serialize";

export async function GET(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const profile = await db.healthProfile.findUnique({ where: { user: guard.id } });
    if (profile) return json({ profile: serializeHealthProfile(profile) });
    return json({ message: "No profile found", profile: null });
  } catch (err) {
    console.error("[health] GET failed:", err);
    return json({ message: "Failed to fetch health profile" }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const body = await readJson<Record<string, unknown>>(req);
    const data = {
      age: typeof body.age === "number" ? body.age : body.age ? Number(body.age) : null,
      gender: (body.gender as string) ?? null,
      height: typeof body.height === "number" ? body.height : body.height ? Number(body.height) : null,
      weight: typeof body.weight === "number" ? body.weight : body.weight ? Number(body.weight) : null,
      bloodGroup: (body.bloodGroup as string) ?? null,
      medicalConditions: JSON.stringify(body.medicalConditions ?? []),
      allergies: JSON.stringify(body.allergies ?? []),
      medications: JSON.stringify(body.medications ?? []),
      emergencyContact: body.emergencyContact ? JSON.stringify(body.emergencyContact) : Prisma.DbNull,
      lastCheckup: body.lastCheckup ? new Date(body.lastCheckup as string) : null,
    };

    const existing = await db.healthProfile.findUnique({ where: { user: guard.id } });
    const profile = existing
      ? await db.healthProfile.update({ where: { user: guard.id }, data })
      : await db.healthProfile.create({ data: { ...data, user: guard.id } });

    return json({ profile: serializeHealthProfile(profile) });
  } catch (err) {
    console.error("[health] POST failed:", err);
    return json({ message: "Failed to save health profile" }, 500);
  }
}
