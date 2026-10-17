/**
 * Authorized Tool Layer (AI-architecture spec §20-21, §10, §42-44).
 *
 * "الحماية يجب أن تكون في الكود أيضًا" — protection must live in the CODE,
 * not only in the prompt. Every tool call:
 *   1. checks the CALLING AGENT against the registry permissions, and
 *   2. scopes the data to the VERIFIED caller's userId (never a body id).
 * A denied call throws ToolPermissionError and is recorded in the AiLog
 * (safetyResult "tool_denied") — the monitoring page surfaces these.
 *
 * §42-44 (ML is not an agent): getStoredRiskExplanation returns ONLY the
 * STORED prediction + explanation. The LLM explains it; it never computes,
 * alters, or overrides it.
 */

import { db } from "@/lib/db";
import { checkDrugInteractions } from "../drug-interactions";
import { getAdherenceSummary } from "../adherence-engine";
import { AGENTS, type AgentKey, type ToolName } from "./agent-registry";

export class ToolPermissionError extends Error {
  constructor(tool: ToolName, agent: AgentKey) {
    super(`Tool "${tool}" is not permitted for agent "${agent}"`);
    this.name = "ToolPermissionError";
  }
}

export interface ToolCallContext {
  /** The agent requesting the data — permission key (§21). */
  agentKey: AgentKey;
  /** The VERIFIED user (requireSelf) — authorization key (§10). */
  userId: string;
}

const ALL_TOOLS: ToolName[] = [
  "getMedications",
  "checkInteractions",
  "getDoseHistory",
  "getAdherenceSummary",
  "getHealthProfile",
  "getStoredRiskExplanation",
];

export function toolPermitted(tool: ToolName, agentKey: AgentKey): boolean {
  return (AGENTS[agentKey]?.tools || []).includes(tool);
}

/** Permission gate — call BEFORE touching any data. */
function assertPermission(tool: ToolName, ctx: ToolCallContext): void {
  if (!ALL_TOOLS.includes(tool)) {
    throw new ToolPermissionError(tool, ctx.agentKey);
  }
  if (!toolPermitted(tool, ctx.agentKey)) {
    console.warn(
      `[ai-tools] DENIED: agent "${ctx.agentKey}" attempted tool "${tool}" — registry says no.`
    );
    throw new ToolPermissionError(tool, ctx.agentKey);
  }
}

// ---------------------------------------------------------------------------
// Tool implementations (all scoped to ctx.userId)
// ---------------------------------------------------------------------------

export interface MedicationToolRow {
  name: string;
  dosage: string;
  times: string[];
}

export async function getMedications(
  ctx: ToolCallContext
): Promise<MedicationToolRow[]> {
  assertPermission("getMedications", ctx);
  // Medication's owner column is `userId` (a previous `where: { user: ... }`
  // was an invalid Prisma field — the tool failed SILENTLY inside the
  // non-fatal catch, so agents answered without the caller's medication
  // context. Caught via the prisma:error entries in dev.log.)
  const meds = await db.medication.findMany({
    where: { userId: ctx.userId },
    select: { pillName: true, dosageAmount: true, frequency: true, dosageTimes: true },
    take: 40,
  });
  return meds.map((m) => ({
    name: m.pillName,
    dosage: m.dosageAmount || m.frequency || "",
    times: Array.isArray(m.dosageTimes) ? (m.dosageTimes as string[]) : [],
  }));
}

export async function checkInteractions(
  ctx: ToolCallContext,
  drugNames: string[]
) {
  assertPermission("checkInteractions", ctx);
  const names = (drugNames || []).filter((n) => typeof n === "string" && n.trim());
  if (names.length < 2) return { interactions: [] };
  // checkDrugInteractions(newDrug, existing[]) — evaluate each med against
  // the rest, dedup pairs (A+B === B+A).
  const seen = new Set<string>();
  const all: { severity: string; description: string; drug1: string; drug2: string; source: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    const rest = names.filter((_, j) => j !== i);
    const res = await checkDrugInteractions(names[i], rest);
    for (const inter of res.interactions) {
      const key = [inter.drug1, inter.drug2].map((s) => s.toLowerCase()).sort().join("+");
      if (!seen.has(key)) {
        seen.add(key);
        all.push(inter);
      }
    }
  }
  return { interactions: all };
}

export interface DoseHistoryToolSummary {
  windowDays: number;
  byStatus: Record<string, number>;
  missedThisWeek: number;
  delayedThisWeek: number;
}

export async function getDoseHistory(
  ctx: ToolCallContext,
  windowDays = 30
): Promise<DoseHistoryToolSummary> {
  assertPermission("getDoseHistory", ctx);
  const since = new Date(Date.now() - windowDays * 86400000);
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const events = await db.doseEvent.findMany({
    where: { userId: ctx.userId, scheduledAt: { gte: since } },
    select: { status: true, scheduledAt: true },
  });
  const byStatus: Record<string, number> = {};
  for (const e of events) byStatus[e.status] = (byStatus[e.status] || 0) + 1;
  let missedThisWeek = 0;
  let delayedThisWeek = 0;
  for (const e of events) {
    if (e.scheduledAt >= weekAgo) {
      if (e.status === "missed") missedThisWeek++;
      if (e.status === "delayed") delayedThisWeek++;
    }
  }
  return { windowDays, byStatus, missedThisWeek, delayedThisWeek };
}

export async function getAdherence(ctx: ToolCallContext, windowDays = 30) {
  assertPermission("getAdherenceSummary", ctx);
  return getAdherenceSummary(ctx.userId, windowDays);
}

export async function getHealthProfile(ctx: ToolCallContext) {
  assertPermission("getHealthProfile", ctx);
  const profile = await db.healthProfile.findFirst({
    where: { user: ctx.userId },
  });
  if (!profile) return null;
  const asArray = (v: unknown): string[] =>
    Array.isArray(v) ? (v as string[]) : typeof v === "string" && v.startsWith("[")
      ? JSON.parse(v)
      : [];
  return {
    age: profile.age ?? null,
    gender: profile.gender ?? null,
    heightCm: profile.height ?? null,
    weightKg: profile.weight ?? null,
    bloodGroup: profile.bloodGroup ?? null,
    conditions: asArray(profile.medicalConditions),
    allergies: asArray(profile.allergies),
  };
}

export interface StoredRiskItem {
  medicationId: string;
  riskScore: number;
  riskLevel: string;
  scheduledAt: string;
  /** Bilingual per-feature explanation STORED by the ML pipeline (§44). */
  explanation: unknown;
}

/**
 * §42-44: the agent may only READ the stored prediction + its explanation.
 * It must never recompute, re-score or "fix" the risk.
 */
export async function getStoredRiskExplanation(
  ctx: ToolCallContext,
  limit = 3
): Promise<StoredRiskItem[]> {
  assertPermission("getStoredRiskExplanation", ctx);
  const soon = new Date(Date.now() + 48 * 3600000);
  const predictions = await db.riskPrediction.findMany({
    where: { userId: ctx.userId, createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    orderBy: [{ riskScore: "desc" }, { createdAt: "desc" }],
    take: limit * 3, // over-fetch, then keep only upcoming-dose rows
  });
  if (predictions.length === 0) return [];
  const doseIds = [...new Set(predictions.map((p) => p.doseEventId))];
  const doses = await db.doseEvent.findMany({
    where: { id: { in: doseIds }, scheduledAt: { lte: soon } },
    select: { id: true, scheduledAt: true, medicationId: true },
  });
  const doseById = new Map(doses.map((d) => [d.id, d]));
  const upcoming: StoredRiskItem[] = [];
  for (const p of predictions) {
    const dose = doseById.get(p.doseEventId);
    if (!dose) continue;
    upcoming.push({
      medicationId: dose.medicationId,
      riskScore: p.riskScore,
      riskLevel: p.riskLevel,
      scheduledAt: dose.scheduledAt.toISOString(),
      explanation: p.explanation,
    });
    if (upcoming.length >= limit) break;
  }
  return upcoming;
}
