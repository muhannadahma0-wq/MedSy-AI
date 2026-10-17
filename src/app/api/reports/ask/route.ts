import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { chunkReport, retrievePassages } from "@/lib/retrieval";
import type { AssistantApiResponse } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

/**
 * WP3 — grounded Q&A over a stored report.
 * Answer is restricted to retrieved passages; if nothing relevant is
 * retrieved the API returns a localized "not found in this report".
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { reportId?: string; question?: string; locale?: Locale };
    const reportId = body.reportId;
    const question = body.question?.trim();
    const locale: Locale = body.locale === "en" ? "en" : "ar";

    if (!reportId || !question || question.length < 3) {
      return NextResponse.json({ error: "reportId and question are required" }, { status: 400 });
    }

    const report = await db.report.findUnique({ where: { id: reportId } });
    if (!report) {
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const passages = chunkReport(report.content);
    const retrieved = retrievePassages(question, passages);

    if (retrieved.length === 0) {
      const payload: AssistantApiResponse = {
        reply:
          locale === "ar"
            ? "لم يُعثر على هذه المعلومة في التقرير."
            : "This information was not found in the report.",
        emergency: false,
        grounded: false,
        citations: [],
      };
      return NextResponse.json(payload);
    }

    const languageLine =
      locale === "ar"
        ? "Answer in clear Modern Standard Arabic. Keep medical values and test names in Latin script."
        : "Answer in clear, simple English.";

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: "assistant",
          content: `You are the report Q&A engine of MedSync AI. You answer patient questions STRICTLY from the numbered report passages provided below.

${languageLine}

Rules (non-negotiable):
- Use ONLY the passages. Never add outside medical facts, never invent values.
- Cite every claim with passage numbers like [1] or [2][3].
- Quote exact values from the passages when relevant.
- If the passages do not contain the answer, reply exactly: NOT_FOUND
- Keep the answer under 150 words. Do not diagnose or suggest treatment changes.`,
        },
        {
          role: "user",
          content: `Report title: ${report.title}

Passages:
${retrieved.map((r, i) => `[${i + 1}] ${r.passage}`).join("\n\n")}

Question: ${question}`,
        },
      ],
      thinking: { type: 'disabled' },
    });

    let reply = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!reply || reply.includes("NOT_FOUND")) {
      const payload: AssistantApiResponse = {
        reply:
          locale === "ar"
            ? "لم يُعثر على هذه المعلومة في التقرير."
            : "This information was not found in the report.",
        emergency: false,
        grounded: false,
        citations: [],
      };
      return NextResponse.json(payload);
    }

    const payload: AssistantApiResponse = {
      reply,
      emergency: false,
      grounded: true,
      citations: retrieved.map((r, i) => ({ index: i + 1, passage: r.passage })),
    };
    return NextResponse.json(payload);
  } catch (e) {
    console.error("report ask error", e);
    return NextResponse.json({ error: "Q&A failed, please retry" }, { status: 500 });
  }
}
