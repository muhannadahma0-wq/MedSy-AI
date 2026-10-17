import { NextResponse } from "next/server";
import { ensureTodayDoses, getTodaySummary } from "@/lib/dose-service";

export async function GET() {
  // Use the authenticated /api/dose-events route in production.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await ensureTodayDoses();
  const summary = await getTodaySummary();
  return NextResponse.json(summary);
}
