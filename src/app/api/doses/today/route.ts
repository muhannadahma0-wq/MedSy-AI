import { NextResponse } from "next/server";
import { ensureTodayDoses, getTodaySummary } from "@/lib/dose-service";

export async function GET() {
  await ensureTodayDoses();
  const summary = await getTodaySummary();
  return NextResponse.json(summary);
}
