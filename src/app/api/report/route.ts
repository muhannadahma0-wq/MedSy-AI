/**
 * POST /api/report — port of server/src/api/reportController.js.
 * Computes the same adherence metrics JSON the original built, then renders
 * it as a local PDF (apitemplate.io is unavailable in this sandbox) and
 * returns { success, message, downloadUrl } with the same contract.
 */
import { db } from "@/lib/db";
import { json, readJson } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { parseJson, type AdherenceRecord } from "@/lib/server/serialize";
import { renderReportPdf, type ReportPayload } from "@/lib/server/report-pdf";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  try {
    const body = await readJson<{
      periodInDays?: number;
      userId?: string;
      user?: { id?: string };
      language?: string;
    }>(req);

    // Phase 12 — BOLA guard: reports are generated only for the caller.
    const requested = body.user?.id || body.userId || null;
    const guard = await requireSelf(req, requested);
    if (guard instanceof Response) return guard;
    const userId = guard.id;

    const periodInDays = body.periodInDays || 30;

    const startDate = new Date();
    const endDate = new Date();
    startDate.setDate(endDate.getDate() - periodInDays);

    const allMedi = await db.medication.findMany({ where: { userId } });

    const user = await db.user.findUnique({ where: { id: userId } });
    const profile = await db.healthProfile.findUnique({ where: { user: userId } });

    if (!user) {
      return json({ success: false, message: "Server error while generating report" }, 500);
    }

    // formatAdherenceHistory
    const historyLog: ReportPayload["adherenceHistory"] = [];
    allMedi.forEach((med) => {
      parseJson<AdherenceRecord[]>(med.adherenceHistory, []).forEach((h) => {
        const historyDate = new Date(h.date);
        if (historyDate >= startDate && historyDate <= endDate) {
          historyLog.push({
            historyDate: historyDate.toDateString(),
            historyTime: h.time,
            historyStatus: h.status,
            historyTakenAt: h.takenAt ? new Date(h.takenAt).toLocaleString() : "N/A",
          });
        }
      });
    });
    historyLog.sort((a, b) => new Date(a.historyDate).getTime() - new Date(b.historyDate).getTime());

    // calculateReportMetrics
    let totalScheduledDoses = 0;
    let totalTakenDoses = 0;
    const medicationPerformance: ReportPayload["medications"] = allMedi.map((med) => {
      const relevantHistory = parseJson<AdherenceRecord[]>(med.adherenceHistory, []).filter((h) => {
        const historyDate = new Date(h.date);
        return historyDate >= startDate && historyDate <= endDate;
      });

      const scheduled = relevantHistory.length;
      const taken = relevantHistory.filter((h) => h.status === "taken").length;
      const missed = scheduled - taken;

      totalScheduledDoses += scheduled;
      totalTakenDoses += taken;

      return {
        pillName: med.pillName,
        pillDescription: med.pillDescription || " ",
        dosageAmount: med.dosageAmount || "",
        frequency: med.frequency || "",
        // P1-40 — no scheduled doses in the window → "N/A", not a fake 100%.
        medicationAdherenceRate: scheduled > 0 ? Math.round((taken / scheduled) * 100) : "N/A",
        missedDosesCountForPill: missed,
      };
    });

    const totalMissedDoses = totalScheduledDoses - totalTakenDoses;
    // P1-40 — zero scheduled doses is "N/A — insufficient data", never 100%.
    const overallAdherenceRate: number | "N/A" =
      totalScheduledDoses > 0 ? Math.round((totalTakenDoses / totalScheduledDoses) * 100) : "N/A";

    const payload: ReportPayload = {
      userName: user.name,
      userEmail: user.email,
      age: profile?.age ?? "N/A",
      gender: profile?.gender ?? "N/A",
      weight: profile?.weight ? `${profile.weight} kg` : "N/A",
      height: profile?.height ? `${profile.height} cm` : "N/A",
      reportPeriod: `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      generationDate: endDate.toLocaleDateString(),
      overallAdherenceRate,
      totalScheduledDoses,
      totalTakenDoses,
      totalMissedDoses,
      medications: medicationPerformance,
      adherenceHistory: historyLog,
    };

    const { downloadUrl } = await renderReportPdf(
      payload,
      body.language === "ar" ? "ar" : "en"
    );

    return json({
      success: true,
      message: "Report generated successfully!",
      downloadUrl,
    });
  } catch (err) {
    console.error("Error generating report:", err);
    return json({ success: false, message: "Server error while generating report" }, 500);
  }
}

export const POST = withMetrics("POST /api/report", handler_POST);
