/**
 * Resilience layer + Google-services bridge.
 *
 * The primary architecture is the original MedSync-AI one: each agent is a
 * separate module with its own LangChain ChatGroq instance and settings
 * (see src/lib/server/models/*.ts), and translation uses
 * ChatGoogleGenerativeAI (Gemini via GOOGLE_API_KEY).
 *
 * This module exists because some networks (including the sandbox this app
 * is previewed in) sit in regions that Groq / Google's direct API refuse to
 * serve (HTTP 403 / "User location is not supported"), and because
 * GOOGLE_API_KEY / GROQ_API_KEY may not be provisioned on the host. When a
 * primary provider call fails for ANY reason, the calling agent falls back
 * here with the exact same prompt so the user still gets an answer.
 *
 * PROVIDER TRUTH (live-probed 2026-09-27, scripts/provider-probe.ts): the
 * z-ai gateway serves GLM (Zhipu AI) for every requested model name —
 * "gemini-2.5-flash", "gemini-2.5-pro", "glm-4.6" all self-identify as
 * GLM by Zhipu AI, and the model parameter is ignored. It is therefore NOT
 * a Google Gemini bridge. Direct Gemini (ChatGoogleGenerativeAI) requires
 * GOOGLE_API_KEY; without it the fallback answers come from GLM via z-ai.
 *
 * Provider chain, end to end:
 *   1. Groq (LangChain ChatGroq — needs GROQ_API_KEY)
 *   2. Gemini direct (LangChain ChatGoogleGenerativeAI — needs GOOGLE_API_KEY)
 *   3. GLM via z-ai gateway (default fallback; Zhipu AI model, no key needed)
 */

import ZAI from "z-ai-web-dev-sdk";

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

export interface FallbackMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Model name requested from the z-ai gateway. Empty by default because the
 * gateway serves GLM regardless of the requested name (see provider truth
 * above). Set ZAI_FALLBACK_MODEL to pin a specific gateway model if one is
 * ever honored. Exported so health/status endpoints can report the provider.
 */
export const ZAI_FALLBACK_MODEL = process.env.ZAI_FALLBACK_MODEL || "";

/** MASTER AUDIT P1-45 — the last-resort path must never hang a request. */
const ZAI_TIMEOUT_MS = Number(process.env.ZAI_TIMEOUT_MS || 60_000);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export async function zaiComplete(
  messages: FallbackMessage[],
  options: { temperature?: number; model?: string } = {}
): Promise<string> {
  const zai = await getClient();
  const model = options.model ?? ZAI_FALLBACK_MODEL;
  const base = {
    messages,
    temperature: options.temperature ?? 0,
    thinking: { type: "disabled" as const },
  };
  try {
    // Fallback path: GLM (Zhipu AI) via the z-ai gateway. Only pass a model
    // name when one is explicitly configured (the gateway ignores it anyway).
    const completion = await withTimeout(
      zai.chat.completions.create(model ? { ...base, model } : base),
      ZAI_TIMEOUT_MS,
      "z-ai gateway call"
    );
    const content = completion.choices[0]?.message?.content ?? "";
    if (content.trim().length > 0) return content;
    throw new Error("empty completion from gateway");
  } catch (gatewayError) {
    // Final resilience: retry once with the plain gateway defaults.
    try {
      const completion = await withTimeout(
        zai.chat.completions.create(base),
        ZAI_TIMEOUT_MS,
        "z-ai gateway retry"
      );
      return completion.choices[0]?.message?.content ?? "";
    } catch {
      // Both gateway paths failed — surface the original gateway error.
      throw gatewayError;
    }
  }
}
