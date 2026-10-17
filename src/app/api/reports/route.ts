import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import type { ReportAnalysis } from "@/lib/types";

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const report = await db.report.findUnique({ where: { id } });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }
    return NextResponse.json({
      id: report.id,
      title: report.title,
      createdAt: report.createdAt.toISOString(),
      content: report.content,
      analysis: report.analysis ? (JSON.parse(report.analysis) as ReportAnalysis) : null,
    });
  }
  const reports = await db.report.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({
    reports: reports.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt.toISOString(),
      hasAnalysis: Boolean(r.analysis),
    })),
  });
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const body = (await req.json()) as { title?: string; content?: string; locale?: Locale };
    const title = body.title?.trim();
    const content = body.content?.trim();
    if (!title || title.length < 2) {
      return NextResponse.json({ error: "Report title is required" }, { status: 400 });
    }
    if (!content || content.length < 60) {
      return NextResponse.json({ error: "Report text is too short (min 60 characters)" }, { status: 400 });
    }
    const locale: Locale = body.locale === "en" ? "en" : "ar";

    const zai = await ZAI.create();
    const languageLine =
      locale === "ar"
        ? "Write the analysis in clear Modern Standard Arabic, but keep medical test names and values in Latin script as well."
        : "Write the analysis in clear, simple English.";

    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content: `You are the report-analysis engine of MedSync AI. You analyze a patient's medical report and return ONLY a valid JSON object (no markdown fences, no commentary).

${languageLine}

Return exactly this JSON shape:
{
  "summary": "3-4 sentence plain-language summary of the report",
  "keyFindings": [{"finding": "one-line finding in patient-friendly words", "source": "the exact short quote from the report supporting it"}],
  "warnings": ["any value out of the normal range or a clinically notable phrase, one per item, with the value"],
  "readability": {"level": "easy|medium|hard", "note": "one short sentence about how hard this text is to read for a patient"}
}

Rules:
- Every keyFinding must include a "source" quote copied verbatim from the report.
- 3-6 keyFindings maximum.
- Do NOT diagnose, do NOT suggest treatment changes; flag concerns and recommend discussing them with the doctor.
- "readability.level": easy = short sentences, common words; hard = dense clinical jargon.`,
        },
        { role: "user", content: `Analyze this medical report:\n\nTITLE: ${title}\n\nCONTENT:\n${content.slice(0, 8000)}` },
      ],
      thinking: { type: "disabled" },
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    let analysis: ReportAnalysis;
    try {
      const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      analysis = JSON.parse(jsonText) as ReportAnalysis;
      if (!analysis.summary || !Array.isArray(analysis.keyFindings)) throw new Error("bad shape");
    } catch {
      analysis = {
        summary: raw.slice(0, 600) || "Analysis unavailable.",
        keyFindings: [],
        warnings: [],
        readability: { level: "medium", note: "" },
      };
    }

    const report = await db.report.create({
      data: { title, content, analysis: JSON.stringify(analysis) },
    });

    return NextResponse.json(
      {
        id: report.id,
        title: report.title,
        createdAt: report.createdAt.toISOString(),
        analysis,
      },
      { status: 201 }
    );
  } catch (e) {
    console.error("report analyze error", e);
    return NextResponse.json({ error: "Analysis failed, please retry" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  try {
    await db.report.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }
}
