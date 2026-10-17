/**
 * GET /api/healthz — liveness probe (plan §43). Unauthenticated by design:
 * answers "is the process up?" with version + uptime + engine mode only.
 * No sensitive data (no JWTs, tokens, or medical data).
 */
import { json } from "@/lib/server/http";
import { getEngineMode } from "@/lib/server/reminder-engine";
import { ZAI_FALLBACK_MODEL } from "@/lib/server/models/zai-fallback";
import { withMetrics } from "@/lib/server/metrics";

const BOOTED_AT = Date.now();

async function handler_GET() {
  return json({
    status: "ok",
    service: "medsync-ai",
    version: process.env.npm_package_version ?? "0.1.0",
    uptimeSeconds: Math.round((Date.now() - BOOTED_AT) / 1000),
    engineMode: getEngineMode(),
    aiProviders: {
      // Direct LangChain paths — active only when keys are provisioned.
      groq: Boolean(process.env.GROQ_API_KEY),
      geminiDirect: Boolean(process.env.GOOGLE_API_KEY),
      // Always-on last resort via the z-ai gateway. HONEST LABEL (MR-8 fix,
      // 2026-10-01): the z-ai gateway serves GLM (Zhipu AI) regardless of the
      // requested model name — proven by scripts/provider-probe.ts — so this
      // field is named for what it actually is, not "Gemini".
      zaiGlm: ZAI_FALLBACK_MODEL,
    },
    timestamp: new Date().toISOString(),
  });
}

export const GET = withMetrics("GET /api/healthz", handler_GET);
