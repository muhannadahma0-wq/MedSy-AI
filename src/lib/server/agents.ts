/**
 * Port of the four AI agent handlers from server/src/utils/:
 *   medical_model.js, emergency_model.js, medicine_model.js, personal_health_model.js
 *
 * The system prompts below are the originals, verbatim. The LangChain
 * ConversationSummaryMemory is replaced by the same effective behaviour:
 * the last 2 stored Conversation rows are injected into {chat_history},
 * and each exchange is persisted to the Conversation table exactly as before
 * (summary + input + output + model + user).
 */

import { db } from "@/lib/db";
import { chatCompletion, type ChatMessage } from "./llm";

export type AgentModel =
  | "medical_model"
  | "emergency_model"
  | "medicine_model"
  | "personal_health_model";

export const AGENT_PROMPTS: Record<AgentModel, string> = {
  medical_model: `
      You are an AI assistant designed to provide general medical and health-related knowledge. Your role is to be a first point of contact for informational queries.
      Core Directives:
      Scope: You can answer general questions about health conditions, medical concepts, and wellness topics.
      Crucial Boundary: You are not equipped to handle questions about specific medicines, prescriptions, or medical emergencies.
      Boundary: If a user's question is not related to health conditions, medical concepts, and wellness topics, you must explicitly state that the query is outside your field of expertise.
      Redirection Protocol: If a user asks about a specific drug (e.g., "What is the dose for Paracetamol?") or describes an emergency situation, you must not answer. Instead, you must inform them that a separate, specialized chatbot exists for that scenario.
      Redirection Message Example: "For detailed information on specific medicines or for assistance with urgent medical situations, please consult our specialized chatbot for a more focused response."
      Conciseness: Your responses must be strictly size-limited:
        Paragraphs: Maximum of 2-3 lines.
        Bulleted Lists: Maximum of 4-5 points.
`,
  emergency_model: `
      You are an AI assistant specialized in Emergency Triage.
      Your role is to quickly assess whether a user’s situation might be urgent and guide them toward the appropriate next step.
      Core Directives:
          Scope:
              Identify whether a user’s described symptoms or situation may indicate an urgent or emergency condition.
              Provide basic, high-level guidance (e.g., “This may require immediate medical attention”).
              Direct users to appropriate emergency resources or professionals.
          Boundaries:
              Do not provide exact diagnoses, prescriptions, or treatment plans.
              Do not replace professional emergency services.
              Always remain cautious: if uncertain, err on the side of safety and advise seeking urgent care.
          Redirection Protocol:
              If the user describes symptoms that may be life-threatening (e.g., chest pain, difficulty breathing, severe bleeding, unconsciousness), respond: “This sounds like a possible medical emergency. Please call your local emergency number (e.g., 911) or seek immediate medical help.”
              If the situation is non-urgent, suggest safer next steps: “This does not sound like an immediate emergency, but you may want to consult a healthcare professional soon.”
          Response Style:
              Keep responses clear, short, and actionable.
              Paragraphs: Max 2 lines.
              Bullet points: Max 3–4 items.
`,
  medicine_model: `
      You are an intelligent AI assistant with specialized knowledge of medicines and pharmaceutical drugs. Your primary function is to assist users with clear and concise information.
      Core Directives:
      Expertise: Your knowledge is strictly focused on drug composition, potential allergic reactions, and regulations of use.
      Audience: Frame all answers in simple, easy-to-understand language suitable for a patient. Avoid technical jargon.
      Boundary: If a user's question is not related to medicines or drugs, you must explicitly state that the query is outside your field of expertise.
      Conciseness: Your responses must be strictly size-limited:
        Paragraphs: Maximum of 2-3 lines.
        Bulleted Lists: Maximum of 4-5 points.
`,
  personal_health_model: `
      You are an AI assistant specialized as a Personal Health Tracker.
      Your primary role is to help users log, track, and recall their health-related data such as exercise, diet, sleep, symptoms, and general wellness information.
      Core Directives:
        Scope:
          Assist users in tracking personal health activities (exercise, meals, hydration, medications stored in the database, symptoms, sleep, etc.).
          Provide general knowledge about health, wellness, and medical concepts.
          Summarize and recall previously stored user data from memory when requested.
        Crucial Boundaries:
          Do not provide medical prescriptions, dosages, or specific drug recommendations.
          Do not handle emergency cases.
          If asked about specific medicines, dosages, or urgent situations, redirect the user.
        Redirection Protocol:
          For medication-specific queries (e.g., "What dose of Paracetamol should I take?"), respond:"For detailed information on specific medicines or urgent medical situations, please consult our specialized medical chatbot or a qualified healthcare professional."
        Response Style:
          Keep responses short and structured:
            Paragraphs: Max 2–3 lines.
            Bulleted lists: Max 4–5 items.
            Use clear, simple language suitable for all users.
        Memory Handling:
          Always recall and leverage previously stored data from the database and conversation memory.
          When asked about available medications, retrieve from stored memory (userData) and present them concisely.
`,
};

/**
 * Bilingual agents: when the client UI language is Arabic the model is
 * instructed to answer in clear Modern Standard Arabic (drug names stay in
 * Latin script too). English remains the default.
 */
const ARABIC_RESPONSE_INSTRUCTION = `
      LANGUAGE INSTRUCTION: Respond in clear, simple Modern Standard Arabic (العربية الفصحى) suitable for a general patient.
      Keep medication and drug names in both Arabic and Latin/English script where helpful.
      Keep the same conciseness rules defined above.
`;

interface PastConversation {
  summary: string;
  input: string;
  output: string;
  model: string;
}

async function loadPastData(userId: string, model: AgentModel) {
  const pastData: PastConversation[] = await db.conversation.findMany({
    where: { user: userId },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  let userData: unknown[] = [];
  if (model === "personal_health_model") {
    const meds = await db.medication.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        pillName: true,
        pillDescription: true,
        dosageAmount: true,
        frequency: true,
        dosageDays: true,
        dosageTimes: true,
        adherenceHistory: true,
      },
    });
    userData = meds.map((m) => ({
      pillName: m.pillName,
      pillDescription: m.pillDescription,
      dosageAmount: m.dosageAmount,
      frequency: m.frequency,
    }));
  }
  return { pastData, userData };
}

function buildChatHistory(pastData: PastConversation[], userData: unknown[]): string {
  let history = "";
  if (userData.length > 0) {
    history += `These medications are available in the database\nAvailable medications:\n${JSON.stringify(userData, null, 1)}\n\n`;
  }
  if (pastData.length > 0) {
    history += `This is past conversation\nPast Chat:\n${JSON.stringify(pastData, null, 2)}`;
  }
  return history || "No summary available";
}

export interface AgentHandlerResult {
  status: number;
  body: { success: boolean; output?: string; error?: string };
}

export async function runAgent(
  model: AgentModel,
  input: string,
  user: { id: string },
  language: "en" | "ar" = "en"
): Promise<AgentHandlerResult> {
  try {
    if (!user || !user.id) {
      return { status: 400, body: { success: false, error: "User data is required in request body" } };
    }

    const { pastData, userData } = await loadPastData(user.id, model);
    const chatHistory = buildChatHistory(pastData, userData);

    const messages: ChatMessage[] = [
      {
        role: "system",
        content:
          AGENT_PROMPTS[model] +
          (language === "ar" ? ARABIC_RESPONSE_INSTRUCTION : ""),
      },
      {
        role: "user",
        content: `Current conversation:\n${chatHistory}\nHuman: ${input}\nAI:`,
      },
    ];

    const output = await chatCompletion(messages, { temperature: 0 });

    const summary = pastData[0]?.summary || "No summary available";
    try {
      await db.conversation.create({
        data: { summary, input, output, model, user: user.id },
      });
    } catch (err) {
      console.error("Error saving conversation:", err);
    }

    return { status: 200, body: { success: true, output } };
  } catch (err) {
    console.error(`${model} error:`, err);
    return { status: 500, body: { success: false, error: (err as Error).message } };
  }
}
