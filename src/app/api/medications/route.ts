import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findInteractions } from "@/lib/medical";
import { parseDays, parseTimes } from "@/lib/dose-service";
import type { MedicationDTO } from "@/lib/types";

function toDTO(med: {
  id: string;
  name: string;
  nameAr: string | null;
  dosage: string | null;
  form: string;
  times: string;
  days: string;
  instructions: string | null;
  instructionsAr: string | null;
  color: string;
  startDate: Date;
  active: boolean;
}): MedicationDTO {
  return {
    id: med.id,
    name: med.name,
    nameAr: med.nameAr,
    dosage: med.dosage,
    form: med.form,
    times: parseTimes(med.times),
    days: parseDays(med.days),
    instructions: med.instructions,
    instructionsAr: med.instructionsAr,
    color: med.color,
    startDate: med.startDate.toISOString(),
    active: med.active,
  };
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const meds = await db.medication.findMany({
    where: { active: true },
    orderBy: { createdAt: "asc" },
  });
  const interactions = findInteractions(meds.map((m) => m.name));
  return NextResponse.json({ medications: meds.map(toDTO), interactions });
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const body = (await req.json()) as {
      name?: string;
      nameAr?: string;
      dosage?: string;
      form?: string;
      times?: string[];
      days?: number[];
      instructions?: string;
      instructionsAr?: string;
      color?: string;
    };

    const name = body.name?.trim();
    if (!name || name.length < 2) {
      return NextResponse.json({ error: "Medication name is required" }, { status: 400 });
    }
    const times = (body.times ?? []).filter((t) => /^\d{2}:\d{2}$/.test(t));
    if (times.length === 0) {
      return NextResponse.json({ error: "At least one valid time (HH:MM) is required" }, { status: 400 });
    }
    const days = (body.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    if (days.length === 0) {
      return NextResponse.json({ error: "At least one day is required" }, { status: 400 });
    }

    const med = await db.medication.create({
      data: {
        name,
        nameAr: body.nameAr?.trim() || null,
        dosage: body.dosage?.trim() || null,
        form: body.form ?? "tablet",
        times: JSON.stringify([...new Set(times)].sort()),
        days: JSON.stringify([...new Set(days)].sort((a, b) => a - b)),
        instructions: body.instructions?.trim() || null,
        instructionsAr: body.instructionsAr?.trim() || null,
        color: body.color ?? "teal",
      },
    });

    const allNames = (await db.medication.findMany({ where: { active: true } })).map((m) => m.name);
    const interactions = findInteractions(allNames);
    return NextResponse.json({ medication: toDTO(med), interactions }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    await db.medication.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Medication not found" }, { status: 404 });
  }
}
