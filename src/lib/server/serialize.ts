import type { Medication, Report, HealthProfile, DailyNotification, User } from "@prisma/client";

/**
 * Serialization layer — converts Prisma rows (with JSON-string fields for
 * arrays, because SQLite has no scalar lists) into the exact API shapes the
 * original Mongoose/MongoDB backend returned, including the `_id` alias the
 * client pages use (e.g. med._id, report._id).
 */

export interface DosageTime {
  time: string;
  remindBefore: string;
  remindAfter: string;
  status: "pending" | "taken" | "missed" | "delayed" | "skipped";
  takenAt: string | null;
  lastReminderSentAt?: string | null;
  skipReason?: string | null;
}

export interface AdherenceRecord {
  date: string;
  time: string;
  status: "taken" | "missed" | "delayed" | "skipped";
  takenAt: string | null;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Medication row → the object Mongoose's `med.toObject()` returned. */
export function serializeMedication(m: Medication) {
  return {
    _id: m.id,
    id: m.id,
    userId: m.userId,
    pillName: m.pillName,
    pillDescription: m.pillDescription ?? undefined,
    dosageDays: parseJson<string[]>(m.dosageDays, []),
    dosageTimes: parseJson<DosageTime[]>(m.dosageTimes, []),
    dosageAmount: m.dosageAmount ?? undefined,
    frequency: m.frequency ?? undefined,
    startDate: m.startDate,
    endDate: m.endDate,
    originalInstructions: m.originalInstructions ?? undefined,
    translatedInstructions: {
      ar: m.translatedAr ?? undefined,
    },
    adherenceHistory: parseJson<AdherenceRecord[]>(m.adherenceHistory, []),
    doctorName: m.doctorName ?? undefined,
    prescriptionId: m.prescriptionId ?? undefined,
    notes: m.notes ?? undefined,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export function serializeReport(r: Report) {
  return {
    _id: r.id,
    id: r.id,
    userId: r.userId,
    filename: r.filename,
    reportText: r.reportText,
    analysis: r.analysis,
    translatedAnalysis: parseJson<Record<string, string>>(r.translatedAnalysis, {}),
    originalLanguage: r.originalLanguage,
    readabilityScore: r.readabilityScore
      ? parseJson<Record<string, unknown>>(r.readabilityScore, {})
      : undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function serializeHealthProfile(p: HealthProfile) {
  return {
    _id: p.id,
    user: p.user,
    age: p.age ?? undefined,
    gender: p.gender ?? undefined,
    height: p.height ?? undefined,
    weight: p.weight ?? undefined,
    bloodGroup: p.bloodGroup ?? undefined,
    medicalConditions: parseJson<string[]>(p.medicalConditions, []),
    allergies: parseJson<string[]>(p.allergies, []),
    medications: parseJson<string[]>(p.medications, []),
    emergencyContact: p.emergencyContact
      ? parseJson<{ name?: string; phone?: string } | null>(p.emergencyContact, null) ?? undefined
      : undefined,
    lastCheckup: p.lastCheckup ?? undefined,
    createdAt: p.createdAt,
  };
}

export interface NotificationMessage {
  title: string;
  message: string;
  type: "before" | "onTime" | "after" | "test";
  medicineId?: string;
  medicineName?: string;
  time: string;
}

export function serializeDailyNotification(n: DailyNotification): NotificationMessage[] {
  return parseJson<NotificationMessage[]>(n.notifications, []);
}

export function serializeUser(u: User) {
  return {
    id: u.id,
    _id: u.id,
    name: u.name,
    email: u.email,
    preferredLanguage: u.preferredLanguage ?? "en",
    timeZone: u.timeZone,
    isVerified: u.isVerified,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export { parseJson, toDate };
