/**
 * GET  /api/dose-events — DoseEvent queries for the intelligence UI.
 *      ?range=today|upcoming|history&hours=48&limit=50
 * POST /api/dose-events — runs the MEDSYNC-003 migration/preparation pipeline
 *      for a user (auth header/cookie; body { action } defaults to
 *      "prepare" = materialize + migrate + auto-transition).
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import {
  ensureUpcomingDoseEvents,
  migrateAdherenceHistory,
  prepareUserDoseEvents,
} from "@/lib/server/dose-events";
import { getUserTimeZone, startOfDayInZone } from "@/lib/server/tz";
import { withMetrics } from "@/lib/server/metrics";

async function handler_GET(req: Request) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "upcoming";
  const hours = Math.min(168, Math.max(1, parseInt(url.searchParams.get("hours") ?? "48", 10) || 48));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const bodyUserId = url.searchParams.get("userId");

  // Phase 12 — BOLA guard: the query userId may only ever be the caller's own.
  const guard = await requireSelf(req, bodyUserId);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const now = new Date();
  let where;
  if (range === "today") {
    // Phase 3 — "today" is the USER's calendar day, not the server's.
    const tz = await getUserTimeZone(userId);
    const start = startOfDayInZone(now, tz);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    where = { userId, scheduledAt: { gte: start, lt: end } };
  } else if (range === "upcoming") {
    where = {
      userId,
      status: "pending",
      scheduledAt: {
        gte: new Date(now.getTime() - 2 * 3600 * 1000),
        lte: new Date(now.getTime() + hours * 3600 * 1000),
      },
    };
  } else {
    where = { userId };
  }

  const [events, meds] = await Promise.all([
    db.doseEvent.findMany({
      where,
      orderBy: range === "history" ? { scheduledAt: "desc" } : { scheduledAt: "asc" },
      take: limit,
    }),
    db.medication.findMany({
      where: { userId },
      select: { id: true, pillName: true, dosageAmount: true },
    }),
  ]);
  const medById = new Map(meds.map((m) => [m.id, m]));

  return json({
    success: true,
    range,
    count: events.length,
    doseEvents: events.map((e) => ({
      id: e.id,
      medicationId: e.medicationId,
      medicationName: medById.get(e.medicationId)?.pillName ?? "Unknown medication",
      dosageAmount: medById.get(e.medicationId)?.dosageAmount ?? null,
      scheduledAt: e.scheduledAt.toISOString(),
      slotTime: e.slotTime,
      actualAt: e.actualAt ? e.actualAt.toISOString() : null,
      status: e.status,
      skipReason: e.skipReason,
      delayMinutes: e.delayMinutes,
      riskScore: e.riskScore,
      riskLevel: e.riskLevel,
      modelVersion: e.modelVersion,
      source: e.source,
    })),
  });
}

async function handler_POST(req: Request) {
  const body = await readJson<{
    userId?: string;
    localuser?: { id?: string } | string;
    action?: "prepare" | "migrate" | "materialize";
  }>(req);

  // Phase 12 — BOLA guard.
  const guard = await requireSelf(req, body?.userId ?? null);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  const action = body.action ?? "prepare";
  if (action === "migrate") {
    const result = await migrateAdherenceHistory(userId);
    return json({ success: true, action, result });
  }
  if (action === "materialize") {
    const created = await ensureUpcomingDoseEvents(userId);
    return json({ success: true, action, created });
  }
  const result = await prepareUserDoseEvents(userId);
  return json({ success: true, action: "prepare", result });
}

export const GET = withMetrics("GET /api/dose-events", handler_GET);
export const POST = withMetrics("POST /api/dose-events", handler_POST);
