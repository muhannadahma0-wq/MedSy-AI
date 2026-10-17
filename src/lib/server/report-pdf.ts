/**
 * Adherence report PDF generation.
 *
 * The original (server/src/api/reportController.js) POSTed the computed
 * metrics to https://rest.apitemplate.io to render a PDF. This sandbox has
 * no access to that service, so the same JSON payload is rendered locally
 * with pdfkit and served from /reports/<file>. The response contract
 * ({ success, message, downloadUrl }) is unchanged.
 *
 * Bilingual build: the report can be rendered in English (default) or
 * Arabic. Arabic is shaped with arabic-persian-reshaper (contextual
 * presentation forms) and drawn with GNU FreeSerif (embedded from
 * assets/fonts), which contains the Arabic presentation-form glyphs.
 */

import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { ArabicShaper } from "arabic-persian-reshaper";

export interface ReportPayload {
  userName: string;
  userEmail: string;
  age: string | number;
  gender: string;
  weight: string;
  height: string;
  reportPeriod: string;
  generationDate: string;
  overallAdherenceRate: number | "N/A"; // P1-40 — "N/A" when no scheduled doses
  totalScheduledDoses: number;
  totalTakenDoses: number;
  totalMissedDoses: number;
  medications: Array<{
    pillName: string;
    pillDescription: string;
    dosageAmount: string;
    frequency: string;
    medicationAdherenceRate: number | "N/A";
    missedDosesCountForPill: number;
  }>;
  adherenceHistory: Array<{
    historyDate: string;
    historyTime: string;
    historyStatus: string;
    historyTakenAt: string;
  }>;
}

const ORANGE = "#ea580c";

const FREE_SERIF = path.join(process.cwd(), "assets", "fonts", "FreeSerif.ttf");
const FREE_SERIF_BOLD = path.join(process.cwd(), "assets", "fonts", "FreeSerifBold.ttf");

/** Pure-Arabic UI strings for the report (never mixed with Latin values). */
const AR = {
  brand: "ميدسينك الذكي",
  subtitle: "تقرير الالتزام بالدواء",
  patient: "المريض",
  age: "العمر",
  gender: "الجنس",
  weight: "الوزن",
  height: "الطول",
  reportPeriod: "فترة التقرير",
  generated: "تاريخ الإنشاء",
  summary: "الملخص",
  overallAdherenceRate: "معدل الالتزام العام",
  totalScheduledDoses: "إجمالي الجرعات المجدولة",
  totalTakenDoses: "إجمالي الجرعات المتناولة",
  totalMissedDoses: "إجمالي الجرعات الفائتة",
  medicationPerformance: "أداء الأدوية",
  noMedications: "لا توجد أدوية مسجلة لهذه الفترة.",
  adherence: "الالتزام",
  missedDoses: "الجرعات الفائتة",
  notes: "ملاحظات",
  adherenceHistory: "سجل الالتزام (الأحدث أولاً)",
  noHistory: "لا توجد أحداث التزام مسجلة لهذه الفترة.",
  takenAt: "وقت التناول",
  footer: "أنشئ بواسطة ميدسينك الذكي — نسخة مشروع تخرج.",
};

/** Status words shown inside the history log, localized. */
const STATUS_AR: Record<string, string> = {
  taken: "تم تناوله",
  missed: "فائت",
  delayed: "متأخر",
  pending: "قيد الانتظار",
};

/** MASTER AUDIT P1-40 — "85%" or "N/A" when the window has no scheduled doses. */
function pctStr(v: number | "N/A"): string {
  return typeof v === "number" ? `${v}%` : "N/A";
}

/**
 * Prepare a PURE-Arabic string for pdfkit: reshape to contextual
 * presentation forms, then reverse the word order (pdfkit draws LTR;
 * word-level reversal + fontkit's run handling yields correct RTL).
 * Latin/numeric values must be passed separately, never through here.
 */
function ar(text: string): string {
  try {
    const reshaped = ArabicShaper.convertArabic(text);
    return reshaped.split(" ").reverse().join(" ");
  } catch {
    return text;
  }
}

export async function renderReportPdf(
  payload: ReportPayload,
  language: "en" | "ar" = "en"
): Promise<{ filename: string; downloadUrl: string }> {
  const outDir = path.join(process.cwd(), "public", "reports");
  fs.mkdirSync(outDir, { recursive: true });

  const filename = `medsync-report-${Date.now()}.pdf`;
  const filePath = path.join(outDir, filename);
  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const isAr = language === "ar";
  const serif = fs.existsSync(FREE_SERIF) ? FREE_SERIF : undefined;
  const serifBold = fs.existsSync(FREE_SERIF_BOLD) ? FREE_SERIF_BOLD : undefined;

  // In Arabic mode every text run uses FreeSerif so Arabic glyphs resolve.
  const font = (bold = false) => {
    if (isAr && (bold ? serifBold : serif)) {
      doc.font(bold ? serifBold! : serif!);
    } else {
      doc.font("Helvetica-Bold");
    }
  };

  // "label: value" line — Arabic mode puts the value on the left and the
  // (reshaped) label on the right, matching RTL reading order.
  const line = (labelAr: string, value: string, indent = 12) => {
    if (isAr) {
      doc.text(`${value} : ${ar(labelAr)}`, { indent });
    } else {
      doc.text(`${labelAr}: ${value}`, { indent });
    }
  };

  // ── Header ──────────────────────────────────────────────────────────────
  doc.fontSize(22).fillColor(ORANGE);
  font(true);
  doc.text(isAr ? ar(AR.brand) : "MedSync AI", { continued: false });
  doc.fontSize(12).fillColor("#334155");
  font();
  doc.text(isAr ? ar(AR.subtitle) : "Medication Adherence Report");
  doc.moveDown(0.5);
  doc.fontSize(10).fillColor("#475569");
  if (isAr) {
    doc.text(`${ar(AR.patient)}: ${payload.userName}  (${payload.userEmail})`);
    doc.text(
      `${ar(AR.age)}: ${payload.age}   ${ar(AR.gender)}: ${payload.gender}   ${ar(AR.weight)}: ${payload.weight}   ${ar(AR.height)}: ${payload.height}`
    );
    doc.text(`${ar(AR.reportPeriod)}: ${payload.reportPeriod}`);
    doc.text(`${ar(AR.generated)}: ${payload.generationDate}`);
  } else {
    doc.text(`Patient: ${payload.userName}  (${payload.userEmail})`);
    doc.text(`Age: ${payload.age}   Gender: ${payload.gender}   Weight: ${payload.weight}   Height: ${payload.height}`);
    doc.text(`Report period: ${payload.reportPeriod}`);
    doc.text(`Generated: ${payload.generationDate}`);
  }
  doc.moveDown(1);

  // ── Summary metrics ─────────────────────────────────────────────────────
  doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor("#e2e8f0").stroke();
  doc.moveDown(0.8);
  doc.fontSize(14).fillColor("#0f172a");
  font(true);
  doc.text(isAr ? ar(AR.summary) : "Summary");
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor("#334155");
  font();
  line(AR.overallAdherenceRate, `${pctStr(payload.overallAdherenceRate)}`);
  line(AR.totalScheduledDoses, `${payload.totalScheduledDoses}`);
  line(AR.totalTakenDoses, `${payload.totalTakenDoses}`);
  line(AR.totalMissedDoses, `${payload.totalMissedDoses}`);
  doc.moveDown(1);

  // ── Per-medication performance ──────────────────────────────────────────
  doc.fontSize(14).fillColor("#0f172a");
  font(true);
  doc.text(isAr ? ar(AR.medicationPerformance) : "Medication Performance");
  doc.moveDown(0.4);
  if (payload.medications.length === 0) {
    doc.fontSize(11).fillColor("#64748b");
    font();
    doc.text(isAr ? ar(AR.noMedications) : "No medications recorded for this period.", { indent: 12 });
  } else {
    payload.medications.forEach((m) => {
      doc.fontSize(11).fillColor("#0f172a");
      font();
      doc.text(`${m.pillName} — ${m.dosageAmount || "1 dose"}, ${m.frequency || ""}`, { indent: 12 });
      doc.fontSize(10).fillColor("#475569");
      if (isAr) {
        doc.text(`${ar(AR.adherence)}: ${pctStr(m.medicationAdherenceRate)}   ${ar(AR.missedDoses)}: ${m.missedDosesCountForPill}`, { indent: 24 });
        if (m.pillDescription) doc.text(`${ar(AR.notes)}: ${m.pillDescription}`, { indent: 24 });
      } else {
        doc.text(`Adherence: ${pctStr(m.medicationAdherenceRate)}   Missed doses: ${m.missedDosesCountForPill}`, { indent: 24 });
        if (m.pillDescription) doc.text(`Notes: ${m.pillDescription}`, { indent: 24 });
      }
      doc.moveDown(0.3);
    });
  }
  doc.moveDown(0.6);

  // ── Adherence history log ───────────────────────────────────────────────
  doc.fontSize(14).fillColor("#0f172a");
  font(true);
  doc.text(
    isAr ? ar(AR.adherenceHistory) : "Adherence History (most recent first)"
  );
  doc.moveDown(0.4);
  if (payload.adherenceHistory.length === 0) {
    doc.fontSize(11).fillColor("#64748b");
    font();
    doc.text(
      isAr ? ar(AR.noHistory) : "No adherence events recorded for this period.",
      { indent: 12 }
    );
  } else {
    const recent = [...payload.adherenceHistory].reverse().slice(0, 60);
    recent.forEach((h) => {
      doc.fontSize(9).fillColor("#475569");
      font();
      const status = isAr
        ? `${ar(STATUS_AR[h.historyStatus] || h.historyStatus)}`
        : h.historyStatus;
      const takenAt = isAr
        ? `${h.historyDate}  ${h.historyTime}  —  ${status}  (${ar(AR.takenAt)}: ${h.historyTakenAt})`
        : `${h.historyDate}  ${h.historyTime}  —  ${h.historyStatus}  (taken at: ${h.historyTakenAt})`;
      doc.text(takenAt, { indent: 12 });
    });
  }

  doc.moveDown(1);
  doc.fontSize(8).fillColor("#94a3b8");
  font();
  doc.text(
    isAr
      ? ar(AR.footer)
      : "Generated by MedSync AI — graduation project sandbox build."
  );

  doc.end();
  await new Promise<void>((resolve) => {
    stream.on("finish", () => resolve());
    stream.on("error", () => resolve());
  });

  return { filename, downloadUrl: `/reports/${filename}` };
}
