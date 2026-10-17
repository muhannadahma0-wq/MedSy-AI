import ZAI from "z-ai-web-dev-sdk";

/**
 * Shared z-ai-web-dev-sdk client. Replaces the original LangChain + Groq /
 * Gemini models (server/src/utils/*_model.js, reportAnalysis.js) — the same
 * prompts are reused verbatim, only the LLM backend differs.
 */

let zaiPromise: Promise<typeof ZAI> | null = null;

async function getClient() {
  if (!zaiPromise) {
    zaiPromise = (async () => {
      const zai = await ZAI.create();
      return zai;
    })();
  }
  return zaiPromise;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function chatCompletion(
  messages: ChatMessage[],
  options: { temperature?: number } = {}
): Promise<string> {
  const zai = await getClient();
  const completion = await zai.chat.completions.create({
    messages,
    temperature: options.temperature ?? 0,
  });
  return completion.choices[0]?.message?.content ?? "";
}
