/**
 * POST /api/medicine/list — every medication of the caller (not just today's).
 *
 * The Dashboard's plan section renders today's regimen from /api/medicine/today,
 * but a medication scheduled only on certain weekdays is invisible (and
 * unmanageable) on the other days. This endpoint returns the FULL list with the
 * same serialization + localization contract as /today, enabling the
 * "All medications" management view (edit / delete / inspect).
 */
import { db } from "@/lib/db";
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { serializeMedication } from "@/lib/server/serialize";
import { normalizeTimeZone, dayNameInZone } from "@/lib/server/tz";
import { withMetrics } from "@/lib/server/metrics";

export const POST = withMetrics("POST /api/medicine/list", async (req: Request) => {
  // BOLA guard — the list always belongs to the caller.
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const userId = guard.id;

  try {
    const userRow = await db.user.findUnique({
      where: { id: userId },
      select: { preferredLanguage: true, timeZone: true },
    });
    const timeZone = normalizeTimeZone(userRow?.timeZone) ?? "UTC";
    const todayDay = dayNameInZone(new Date(), timeZone);

    let userLanguage = "en";
    if (userRow?.preferredLanguage) userLanguage = userRow.preferredLanguage;
    // Bilingual build — legacy es/hi preferences fall back to English.
    if (userLanguage !== "ar" && userLanguage !== "en") userLanguage = "en";

    const allMeds = await db.medication.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    const localizedMeds = allMeds.map((med) => {
      let instructions = med.originalInstructions || med.pillDescription || "";
      if (userLanguage !== "en") {
        const translated = userLanguage === "ar" ? med.translatedAr : null;
        if (translated) instructions = translated;
      }
      const days = serializeMedication(med).dosageDays ?? [];
      return {
        ...serializeMedication(med),
        displayInstructions: instructions,
        userLanguage,
        scheduledToday: days.includes(todayDay),
      };
    });

    return json(
      {
        success: true,
        message: "All medications fetched successfully",
        data: localizedMeds,
      },
      200
    );
  } catch (error) {
    console.error("Error in fetching all medications:", error);
    return json(
      { success: false, message: "Error fetching medications" },
      500
    );
  }
});
