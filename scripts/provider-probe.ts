/**
 * Live probe: verify which model serves the agent fallback path.
 * Mirrors zai-fallback.ts exactly (ZAI_FALLBACK_MODEL default gemini-2.5-flash).
 */
import ZAI from "z-ai-web-dev-sdk";

async function main() {
  const zai = await ZAI.create();
  const model = process.env.ZAI_FALLBACK_MODEL || "gemini-2.5-flash";

  const ask = async (m: string | undefined) => {
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: "Answer in one short line." },
        { role: "user", content: "Which AI model are you? State your exact model name if you know it." },
      ],
      temperature: 0,
      thinking: { type: "disabled" },
      ...(m ? { model: m } : {}),
    });
    return completion.choices[0]?.message?.content ?? "(empty)";
  };

  console.log(`probe 1 — explicit model "${model}":`);
  console.log("  →", await ask(model));
  console.log("probe 2 — gateway default model:");
  console.log("  →", await ask(undefined));
}
main().catch((e) => console.error("FAILED:", e.message));
