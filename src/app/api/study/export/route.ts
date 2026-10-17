/**
 * GET /api/study/export — pseudonymized research dataset (plan §24 + §32).
 *
 *   ?userId=…    single participant (auth fallback like the other routes)
 *   ?all=1       researcher export across EVERY consented participant
 *   &format=json same rows as a JSON array instead of CSV
 *
 * PSEUDONYMIZATION RED-LINE (§24) — enforced by construction, not by policy:
 *   participant id = sha256(userId + STUDY_SALT).hex.slice(0, 16)
 *   medications    = M01, M02, … indexed by sorted medication id
 *                   (stable within one export)
 *   NEVER included: user name, email, pill names, notes, doctor names.
 * The route never joins the Medication/User tables for display fields —
 * medicationId is only mapped to its M-code.
 *
 * CONSENT GATE (v5 review item 42 / addition I — BEHAVIOUR CHANGE): the
 * dataset now contains ONLY participants with an ACTIVE StudyConsent
 * (row present AND revokedAt is null). Previously every StudyAssignment was
 * exported; a non-consented caller's personal export is now empty (0 rows)
 * and a non-consented participant is excluded from the ?all=1 export. The
 * export metadata carries the consent provenance (version + grantedAt for
 * a personal export; the distinct versions + participant count for ?all=1),
 * and every CSV row carries consent_version / consent_granted_at columns.
 *
 * Rows: one per DoseEvent (ALL statuses) LEFT-joined with that event's
 * SmartReminders (one row per event–reminder pair; events without reminders
 * still emit one row with empty reminder fields) and with the event's LATEST
 * RiskPrediction (risk_score / risk_level / model_version).
 *
 * Output: clean machine-readable CSV (RFC-4180 quoting, CRLF line endings —
 * no comment rows) or the JSON variant { success, generatedAt, pseudonymized,
 * consent, rowCount, rows }.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { withMetrics } from "@/lib/server/metrics";
import { getStudyArm, type StudyArm } from "@/lib/server/study";
import { round4 } from "@/lib/server/study-stats";

const STUDY_SALT = process.env.STUDY_SALT ?? "medsync-study-salt-v1";

const CSV_COLUMNS = [
  "participant",
  "arm",
  "medication",
  "dose_scheduled_at",
  "dose_slot",
  "dose_status",
  "outcome_confirmed",
  "delay_minutes",
  "skip_reason",
  "risk_score",
  "risk_level",
  "model_version",
  "reminder_type",
  "reminder_scheduled_at",
  "reminder_status",
  "reminder_sent_at",
  "exported_at",
  // v5 item 42/I — per-row consent provenance (the participant's ACTIVE
  // consent at export time; empty only if the gate was bypassed, which by
  // construction it cannot be).
  "consent_version",
  "consent_granted_at",
] as const;

type CsvColumn = (typeof CSV_COLUMNS)[number];

/** One export row (= one event–reminder pair; reminder fields null when the event has no reminders). */
interface ExportRow {
  participant: string; // 16-hex pseudonym
  arm: StudyArm;
  medication: string; // M01, M02, …
  dose_scheduled_at: string; // ISO
  dose_slot: string; // "08:00"
  dose_status: string; // pending | taken | delayed | missed | skipped
  outcome_confirmed: 0 | 1 | null; // 1 = taken|delayed, 0 = missed, null = pending/skipped
  delay_minutes: number | null;
  skip_reason: string | null;
  risk_score: number | null; // from the LATEST RiskPrediction, rounded to 4 decimals
  risk_level: string | null;
  model_version: string | null;
  reminder_type: string | null;
  reminder_scheduled_at: string | null; // ISO
  reminder_status: string | null;
  reminder_sent_at: string | null; // ISO, null when not sent
  exported_at: string; // ISO — identical on every row of one export
  consent_version: string; // participant's active consent document version
  consent_granted_at: string; // ISO — when that consent was granted
}

/** Minimal, PII-free projections of the fetched rows. */
interface DoseEventLite {
  id: string;
  medicationId: string;
  scheduledAt: Date;
  slotTime: string;
  status: string;
  delayMinutes: number | null;
  skipReason: string | null;
}

interface ReminderLite {
  doseEventId: string;
  type: string;
  scheduledAt: Date;
  status: string;
  sentAt: Date | null;
}

interface PredictionLite {
  riskScore: number;
  riskLevel: string;
  modelVersion: string;
}

interface ParticipantData {
  userId: string;
  arm: StudyArm;
  consent: { version: string; grantedAt: Date }; // ACTIVE consent — gate guaranteed by the scope logic below
  events: DoseEventLite[];
  remindersByEvent: Map<string, ReminderLite[]>;
  latestPredictionByEvent: Map<string, PredictionLite>;
}

function pseudonymize(userId: string): string {
  return createHash("sha256").update(userId + STUDY_SALT).digest("hex").slice(0, 16);
}

/** RFC-4180: quote a field containing comma / quote / CR / LF, doubling inner quotes. */
function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvCell(value: ExportRow[CsvColumn]): string {
  if (value === null || value === undefined) return "";
  return csvEscape(String(value));
}

export const GET = withMetrics("GET /api/study/export", async (req: Request) => {
  const url = new URL(req.url);
  const all = url.searchParams.get("all") === "1";
  const asJson = url.searchParams.get("format") === "json";

  // Phase 12 — BOLA guard: a personal export is always the caller's own
  // data; the researcher export (?all=1) requires authentication too.
  const guard = await requireSelf(req, all ? null : url.searchParams.get("userId"));
  if (guard instanceof Response) return guard;

  // ── Participant scope ────────────────────────────────────────────────────
  // v5 item 42/I — the research dataset is CONSENT-GATED: only participants
  // with an active (non-revoked) StudyConsent are exported. This is the
  // intended new behaviour (previously every StudyAssignment was included).
  const consentRows = await db.studyConsent.findMany({
    select: { userId: true, version: true, grantedAt: true, revokedAt: true },
  });
  const activeConsentByUser = new Map<string, { version: string; grantedAt: Date }>();
  for (const c of consentRows) {
    if (!c.revokedAt) {
      activeConsentByUser.set(c.userId, { version: c.version, grantedAt: c.grantedAt });
    }
  }

  let participants: { userId: string; arm: StudyArm; consent: { version: string; grantedAt: Date } }[];
  if (all) {
    // Researcher export: every existing StudyAssignment of an ACTIVELY
    // CONSENTED participant, read as stored (never auto-created here).
    const assignments = await db.studyAssignment.findMany({ orderBy: { assignedAt: "asc" } });
    participants = assignments
      .filter(
        (a) => (a.arm === "control" || a.arm === "smart") && activeConsentByUser.has(a.userId)
      )
      .map((a) => ({
        userId: a.userId,
        arm: a.arm as StudyArm,
        consent: activeConsentByUser.get(a.userId)!,
      }));
  } else {
    // Personal export: the caller's own rows, ONLY with active consent —
    // a non-consented caller gets an intentionally empty dataset (and is
    // NOT auto-assigned a study arm by this route).
    const consent = activeConsentByUser.get(guard.id) ?? null;
    if (!consent) {
      participants = [];
    } else {
      const { arm } = await getStudyArm(guard.id);
      participants = [{ userId: guard.id, arm, consent }];
    }
  }

  const exportedAt = new Date().toISOString();

  // ── Fetch + project (per participant) ───────────────────────────────────
  const data: ParticipantData[] = [];
  const medicationIds = new Set<string>();
  for (const p of participants) {
    const [events, reminders, predictions] = await Promise.all([
      db.doseEvent.findMany({ where: { userId: p.userId }, orderBy: { scheduledAt: "asc" } }),
      db.smartReminder.findMany({ where: { userId: p.userId }, orderBy: { scheduledAt: "asc" } }),
      db.riskPrediction.findMany({ where: { userId: p.userId }, orderBy: { createdAt: "desc" } }),
    ]);

    const remindersByEvent = new Map<string, ReminderLite[]>();
    for (const r of reminders) {
      const list = remindersByEvent.get(r.doseEventId) ?? [];
      list.push({
        doseEventId: r.doseEventId,
        type: r.type,
        scheduledAt: r.scheduledAt,
        status: r.status,
        sentAt: r.sentAt,
      });
      remindersByEvent.set(r.doseEventId, list);
    }

    // Ordered createdAt DESC → the first prediction seen per event is the latest.
    const latestPredictionByEvent = new Map<string, PredictionLite>();
    for (const pred of predictions) {
      if (!latestPredictionByEvent.has(pred.doseEventId)) {
        latestPredictionByEvent.set(pred.doseEventId, {
          riskScore: pred.riskScore,
          riskLevel: pred.riskLevel,
          modelVersion: pred.modelVersion,
        });
      }
    }

    for (const e of events) medicationIds.add(e.medicationId);

    data.push({
      userId: p.userId,
      arm: p.arm,
      consent: p.consent,
      events: events.map((e) => ({
        id: e.id,
        medicationId: e.medicationId,
        scheduledAt: e.scheduledAt,
        slotTime: e.slotTime,
        status: e.status,
        delayMinutes: e.delayMinutes,
        skipReason: e.skipReason,
      })),
      remindersByEvent,
      latestPredictionByEvent,
    });
  }

  // ── Medication pseudonym index: sorted medication id → M01, M02, … ──────
  const medIndex = new Map<string, string>();
  [...medicationIds].sort().forEach((id, i) => {
    medIndex.set(id, `M${String(i + 1).padStart(2, "0")}`);
  });

  // ── Rows: one per event–reminder pair (≥1 row per event) ────────────────
  const rows: ExportRow[] = [];
  for (const p of data) {
    const participant = pseudonymize(p.userId);
    for (const e of p.events) {
      const pred = p.latestPredictionByEvent.get(e.id) ?? null;
      const confirmed = e.status === "taken" || e.status === "delayed";
      const base = {
        participant,
        arm: p.arm,
        medication: medIndex.get(e.medicationId) ?? "",
        dose_scheduled_at: e.scheduledAt.toISOString(),
        dose_slot: e.slotTime,
        dose_status: e.status,
        outcome_confirmed: confirmed ? (1 as const) : e.status === "missed" ? (0 as const) : null,
        delay_minutes: e.delayMinutes,
        skip_reason: e.skipReason,
        risk_score: pred ? round4(pred.riskScore) : null,
        risk_level: pred ? pred.riskLevel : null,
        model_version: pred ? pred.modelVersion : null,
        exported_at: exportedAt,
        consent_version: p.consent.version,
        consent_granted_at: p.consent.grantedAt.toISOString(),
      };
      const eventReminders = p.remindersByEvent.get(e.id) ?? [];
      if (eventReminders.length === 0) {
        rows.push({
          ...base,
          reminder_type: null,
          reminder_scheduled_at: null,
          reminder_status: null,
          reminder_sent_at: null,
        });
        continue;
      }
      for (const r of eventReminders) {
        rows.push({
          ...base,
          reminder_type: r.type,
          reminder_scheduled_at: r.scheduledAt.toISOString(),
          reminder_status: r.status,
          reminder_sent_at: r.sentAt ? r.sentAt.toISOString() : null,
        });
      }
    }
  }

  // ── Serialize ────────────────────────────────────────────────────────────
  // Consent provenance metadata (v5 item 42/I): a personal export names the
  // caller's own active consent; the researcher export aggregates it.
  const consentMeta = all
    ? {
        filter: "active-consent-only" as const,
        versions: [...new Set(participants.map((p) => p.consent.version))].sort(),
        participantsWithActiveConsent: participants.length,
      }
    : participants.length > 0
      ? {
          version: participants[0].consent.version,
          grantedAt: participants[0].consent.grantedAt.toISOString(),
        }
      : null;

  if (asJson) {
    return json({
      success: true,
      generatedAt: exportedAt,
      pseudonymized: true,
      consent: consentMeta,
      rowCount: rows.length,
      rows,
    });
  }

  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  }
  const csv = `${lines.join("\r\n")}\r\n`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="medsync-study-export-${Date.now()}.csv"`,
    },
  });
});
