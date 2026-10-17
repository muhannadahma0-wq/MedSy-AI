/**
 * POST /api/medicine/today — port of server/src/api/todaysMedicineController.js.
 * Returns today's medications with instructions localized to the user's
 * preferred language (displayInstructions + userLanguage fields).
 * Phase 3: "today" and its weekday are computed in the USER's timezone.
 */
import { db } from "@/lib/db";
import { withMetrics } from "@/lib/server/metrics";
import { json } from "@/lib/server/http";
import { serializeMedication, parseJson, type DosageTime } from "@/lib/server/serialize";
import { requireSelf } from "@/lib/server/jwt";
import { dayNameInZone, normalizeTimeZone } from "@/lib/server/tz";

export const POST = withMetrics("POST /api/medicine/today", async (req: Request) => {
  // Phase 12 — auth-only: today's medications belong to the caller.
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  const Id = guard.id;

  try {
    const userRow = await db.user.findUnique({
      where: { id: Id },
      select: { preferredLanguage: true, timeZone: true },
    });
    const timeZone = normalizeTimeZone(userRow?.timeZone) ?? "UTC";
    const todayDay = dayNameInZone(new Date(), timeZone);

    // 🌐 Fetch user's preferred language
    let userLanguage = "en";
    if (userRow?.preferredLanguage) userLanguage = userRow.preferredLanguage;
    // Bilingual build — legacy es/hi preferences fall back to English
    if (userLanguage !== "ar" && userLanguage !== "en") userLanguage = "en";

    const allMeds = await db.medication.findMany({ where: { userId: Id } });
    const todaysMeds = allMeds.filter((m) => {
      const days = parseJson<string[]>(m.dosageDays, []);
      return days.includes(todayDay);
    });

    // Sort by time ascending (lexicographic HH:MM compare is
    // timezone-independent and matches the slot strings the UI displays).
    todaysMeds.sort((a, b) => {
      const timeA = parseJson<DosageTime[]>(a.dosageTimes, [])[0]?.time || "00:00";
      const timeB = parseJson<DosageTime[]>(b.dosageTimes, [])[0]?.time || "00:00";
      return timeA.localeCompare(timeB);
    });

    // 🌐 Localize instructions based on user language
    const localizedMeds = todaysMeds.map((med) => {
      let instructions = med.originalInstructions || med.pillDescription || "";

      if (userLanguage !== "en") {
        const translated = userLanguage === "ar" ? med.translatedAr : null;
        if (translated) instructions = translated;
      }

      return {
        ...serializeMedication(med),
        displayInstructions: instructions,
        userLanguage,
      };
    });

    return json(
      {
        success: true,
        message: "todays medicine fetched successfully",
        data: localizedMeds,
      },
      201
    );
  } catch (error) {
    console.error("Error in fetching todays medicine", error);
    return json({ success: false, message: "Error fetching today's medications" }, 500);
  }
});
