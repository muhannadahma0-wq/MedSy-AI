import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { requireSelf } from "@/lib/server/jwt";
import { detectEmergency, findInteractions, INTERACTION_TABLE, normalizeDrug } from "@/lib/medical";
import type { AssistantApiResponse, ChatCitation } from "@/lib/types";
import type { Locale } from "@/lib/i18n";

type Agent = "medication-info" | "adherence-coach" | "triage";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const AGENT_PROMPTS: Record<Agent, string> = {
  "medication-info": `You are the Medication Info agent of MedSync AI, a medication adherence assistant for patients.
You answer questions about medicines, drug interactions, side effects and timing in plain, simple language.
Rules:
- Ground interaction answers in the provided verified interaction table when available; say clearly when something is NOT in the table instead of guessing.
- Never recommend starting, stopping, or changing a dose. Direct dose decisions to the treating doctor or pharmacist.
- Keep answers short (under 180 words), use short paragraphs or bullets.`,
  "adherence-coach": `You are the Adherence Coach agent of MedSync AI.
You help patients build habits and stick to their medication schedule using practical, evidence-based habit advice.
Rules:
- Be warm and encouraging, never judgmental about missed doses.
- Suggest habit-stacking, visible cues, and pairing doses with daily routines.
- Keep answers short (under 180 words), actionable, with a single clear next step.`,
  triage: `You are the Triage Guide agent of MedSync AI.
You help the user judge how urgently they should seek care for a symptom (self-care / see a doctor soon / seek urgent care), based on well-known public guidance.
Rules:
- You NEVER diagnose or prescribe.
- Always err on the side of safety and recommend professional care when uncertain.
- If any red-flag symptom appears (chest pain, breathing difficulty, stroke signs, severe bleeding, suicidal thoughts), tell the user to call emergency services immediately.
- Keep answers short (under 180 words).`,
};

function localizedEmergencyBody(locale: Locale): string {
  return locale === "ar"
    ? "لا أستطيع المساعدة في حالات الطوارئ. يرجى الاتصال برقم الطوارئ المحلي (911 / 101 / 112) أو التوجه إلى أقرب قسم طوارئ فوراً."
    : "I can't help with emergencies. Please call your local emergency number (911 / 101 / 112) or go to the nearest emergency department right now.";
}

export async function POST(req: NextRequest) {
  try {
    const guard = await requireSelf(req);
    if (guard instanceof Response) return guard;

    const body = (await req.json()) as {
      messages?: HistoryMessage[];
      agent?: Agent;
      locale?: Locale;
    };
    const history = (body.messages ?? []).filter(
      (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0
    );
    if (history.length === 0) {
      return NextResponse.json({ error: "messages array is required" }, { status: 400 });
    }
    const agent: Agent = body.agent && body.agent in AGENT_PROMPTS ? body.agent : "medication-info";
    const locale: Locale = body.locale === "en" ? "en" : "ar";
    const lastUser = [...history].reverse().find((m) => m.role === "user");

    // ---- WP3 guardrail: emergency detection → fixed safety message, no LLM ----
    if (lastUser && detectEmergency(lastUser.content)) {
      const payload: AssistantApiResponse = {
        reply: localizedEmergencyBody(locale),
        emergency: true,
        grounded: false,
        citations: [],
      };
      return NextResponse.json(payload);
    }

    // ---- personal context from the demo profile ----
    const meds = await db.medication.findMany({ where: { userId: guard.id, active: true } });
    const medLines = meds
      .map((m) => `- ${m.name}${m.nameAr ? ` (${m.nameAr})` : ""}${m.dosage ? `, ${m.dosage}` : ""} — schedule: ${m.times} on days ${m.days}`)
      .join("\n");
    const interactions = findInteractions(meds.map((m) => m.name));
    const interactionLines = interactions.length
      ? interactions
          .map((w) => `- ${w.drugA} + ${w.drugB} [${w.severity}]: ${locale === "ar" ? w.descriptionAr : w.descriptionEn}`)
          .join("\n")
      : "- (no known interactions among the current medications in the curated table)";

    const languageLine =
      locale === "ar"
        ? "IMPORTANT: Answer in Modern Standard Arabic, clear and simple, suitable for a general patient. Keep drug names in both Arabic and English/Latin script."
        : "IMPORTANT: Answer in clear, simple English suitable for a general patient.";

    const systemPrompt = `${AGENT_PROMPTS[agent]}

${languageLine}

The patient's current medications:
${medLines || "(no medications recorded yet)"}

Verified interaction table (curated, pharmacist-reviewed):
${INTERACTION_TABLE.map((r) => `- ${r.a} + ${r.b} [${r.severity}]: ${locale === "ar" ? r.descriptionAr : r.descriptionEn}`).join("\n")}
Detected among their medications:
${interactionLines}

Safety rules (non-negotiable):
- Never suggest changing or stopping any dose; refer to the doctor or pharmacist.
- End every answer with a one-line reminder to consult a doctor or pharmacist for personal advice.`;

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: systemPrompt },
        ...history.slice(-12).map((m) => ({ role: m.role, content: m.content })),
      ],
      thinking: { type: "disabled" },
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    if (!reply) {
      return NextResponse.json({ error: "The assistant returned an empty answer" }, { status: 502 });
    }

    // ---- citations: interaction-table rows relevant to the question ----
    const q = lastUser?.content?.toLowerCase() ?? "";
    const userMedNames = meds.map((m) => m.name);
    const citations: ChatCitation[] = [];
    let grounded = false;
    INTERACTION_TABLE.forEach((row) => {
      const mentionsA = q.includes(row.a) || q.includes(normalizeDrug(row.a));
      const mentionsB = q.includes(row.b) || q.includes(normalizeDrug(row.b));
      const userHasA = userMedNames.some((n) => normalizeDrug(n) === row.a || normalizeDrug(n).includes(row.a));
      const userHasB = userMedNames.some((n) => normalizeDrug(n) === row.b || normalizeDrug(n).includes(row.b));
      const relevant =
        (mentionsA && (mentionsB || userHasB)) || (mentionsB && (mentionsA || userHasA)) || (userHasA && userHasB);
      if (relevant) {
        grounded = true;
        citations.push({
          index: citations.length + 1,
          passage: `${row.a} + ${row.b} [${row.severity}] — ${locale === "ar" ? row.descriptionAr : row.descriptionEn}`,
        });
      }
    });

    const payload: AssistantApiResponse = { reply, emergency: false, grounded, citations };
    return NextResponse.json(payload);
  } catch (e) {
    console.error("assistant error", e);
    return NextResponse.json({ error: "Assistant unavailable, please retry" }, { status: 500 });
  }
}
