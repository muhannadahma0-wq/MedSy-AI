import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ensureTodayDoses, getTodaySummary } from "@/lib/dose-service";

const VALID = new Set(["taken", "snoozed", "skipped"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { status?: string };
    const status = body.status ?? "";
    if (!VALID.has(status)) {
      return NextResponse.json({ error: "status must be taken | snoozed | skipped" }, { status: 400 });
    }

    await db.doseEvent.update({
      where: { id },
      data: { status, respondedAt: new Date() },
    });

    await ensureTodayDoses();
    const summary = await getTodaySummary();
    return NextResponse.json(summary);
  } catch {
    return NextResponse.json({ error: "Dose not found or invalid body" }, { status: 400 });
  }
}
