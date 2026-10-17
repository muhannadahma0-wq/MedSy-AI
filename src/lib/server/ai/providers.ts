/**
 * Provider Abstraction Layer (AI-architecture spec §3-4, §29-30, §54).
 *
 * Agents NEVER talk to a vendor SDK directly. They call the ModelProvider
 * interface; which provider answers (and in which order) is pure
 * configuration:
 *
 *   MEDICAL_PRIMARY=groq        MEDICAL_SECONDARY=gemini    MEDICAL_FALLBACK=zai
 *   MEDICATION_PRIMARY=groq     ...                          ...
 *   PERSONAL_PRIMARY=groq       ...                          ...
 *   EMERGENCY_PRIMARY=groq      ...                          ...
 *   VISION_PRIMARY=gemini       VISION_FALLBACK=zai
 *
 * Key invariants (spec, verbatim):
 *  - §30 "نفس الـAgent + Provider مختلف" — a fallback retry re-sends the
 *    SAME agent prompt to a different provider. The specialization lives in
 *    the prompt/agent, never in the provider.
 *  - §17/31 Vision is routed to vision-capable providers only
 *    (Gemini direct → z-ai gateway). A text-only model never receives an image.
 *  - Groq's "llama-3.3-70b-versatile" is treated as a LEGACY default: the
 *    model name comes from env (GROQ_CHAT_MODEL) so swapping to a newer
 *    model is a config change, not a code change.
 *
 * Provider truth (live-probed, see zai-fallback.ts): the z-ai gateway serves
 * GLM (Zhipu AI) — reported honestly as provider "zai-glm".
 */

import { ChatGroq } from "@langchain/groq";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { zaiComplete } from "../models/zai-fallback";
import ZAI from "z-ai-web-dev-sdk";

export type ProviderName = "groq" | "gemini" | "zai";

// ---------------------------------------------------------------------------
// MASTER AUDIT P1-44/P1-45 — provider resilience: per-call timeout + circuit
// breaker. The breaker is deliberately simple and in-memory (project stack:
// local memory only): after BREAKER_THRESHOLD consecutive failures a provider
// is skipped for BREAKER_COOLDOWN_MS, then one half-open probe is allowed.
// Failover is ONLY for availability (network / 5xx / 429 / timeout) — app-level
// authorization and validation failures never reach this layer at all.
// ---------------------------------------------------------------------------

const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS || 45_000);
const PROVIDER_VISION_TIMEOUT_MS = Number(process.env.PROVIDER_VISION_TIMEOUT_MS || 90_000);
const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  consecutiveFailures: number;
  openedAt: number | null;
  lastError: string | null;
}

interface BreakerStore {
  providers: Map<ProviderName, BreakerState>;
}

const BREAKER_KEY = "__medsyncProviderBreaker";
const breakerGlobal = globalThis as typeof globalThis & { [BREAKER_KEY]?: BreakerStore };
const breakerStore: BreakerStore = (breakerGlobal[BREAKER_KEY] ??= { providers: new Map() });

function breakerState(name: ProviderName): BreakerState {
  let s = breakerStore.providers.get(name);
  if (!s) {
    s = { consecutiveFailures: 0, openedAt: null, lastError: null };
    breakerStore.providers.set(name, s);
  }
  return s;
}

/** A provider is callable when closed, or when its cooldown elapsed (half-open). */
function breakerCanAttempt(name: ProviderName): boolean {
  const s = breakerState(name);
  if (s.openedAt === null) return true;
  if (Date.now() - s.openedAt >= BREAKER_COOLDOWN_MS) {
    s.openedAt = null; // half-open: the next call is the probe
    return true;
  }
  return false;
}

function breakerRecordSuccess(name: ProviderName): void {
  const s = breakerState(name);
  s.consecutiveFailures = 0;
  s.openedAt = null;
  s.lastError = null;
}

function breakerRecordFailure(name: ProviderName, err: unknown): void {
  const s = breakerState(name);
  s.consecutiveFailures += 1;
  s.lastError = String((err as Error)?.message || "unknown error");
  if (s.consecutiveFailures >= BREAKER_THRESHOLD && s.openedAt === null) {
    s.openedAt = Date.now();
    console.warn(
      `[ai-gateway] circuit breaker OPEN for provider "${name}" after ${s.consecutiveFailures} consecutive failures — skipping for ${BREAKER_COOLDOWN_MS / 1000}s.`
    );
  }
}

/** Health snapshot for the monitoring endpoint. */
export function providerHealth(): Record<
  ProviderName,
  { breaker: "closed" | "open" | "half-open"; consecutiveFailures: number; lastError: string | null }
> {
  const out = {} as Record<ProviderName, { breaker: "closed" | "open" | "half-open"; consecutiveFailures: number; lastError: string | null }>;
  for (const name of ["groq", "gemini", "zai"] as ProviderName[]) {
    const s = breakerState(name);
    out[name] = {
      breaker: s.openedAt === null ? "closed" : "half-open",
      consecutiveFailures: s.consecutiveFailures,
      lastError: s.lastError,
    };
  }
  return out;
}

/** Promise.race timeout wrapper — a hung provider must not hang the request. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
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

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderCallOptions {
  temperature?: number;
  /** Per-call model override (used by the legacy agent modules). */
  model?: string;
}

export interface ProviderResult {
  output: string;
  provider: ProviderName;
  /** Human-readable model label for logging/monitoring. */
  model: string;
  latencyMs: number;
  /** True when a primary provider failed and a later one answered (§29). */
  fallbackUsed: boolean;
}

/** The vendor-agnostic interface every agent programs against (§4). */
export interface ModelProvider {
  readonly name: ProviderName;
  readonly supportsVision: boolean;
  /** Plain text generation. */
  generate(messages: ProviderMessage[], options?: ProviderCallOptions): Promise<string>;
  /**
   * Vision analysis — the image is passed as a data URL and is ALWAYS
   * positioned as untrusted DATA, never as an instruction (§40).
   */
  analyzeImage(
    prompt: string,
    imageDataUrl: string,
    options?: ProviderCallOptions
  ): Promise<string>;
}

// ---------------------------------------------------------------------------
// Groq (text-only on the legacy chat model — §17)
// MASTER AUDIT P0-17: the deprecated "llama-3.3-70b-versatile" default is
// replaced by the currently-supported "openai/gpt-oss-120b" (env-overridable
// via GROQ_CHAT_MODEL — a config change, not a code change).
// ---------------------------------------------------------------------------

const GROQ_CHAT_MODEL = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";

const groqProvider: ModelProvider = {
  name: "groq",
  supportsVision: false,
  async generate(messages, options = {}) {
    const model = new ChatGroq({
      model: options.model || GROQ_CHAT_MODEL,
      temperature: options.temperature ?? 0,
      maxRetries: 1,
      apiKey: process.env.GROQ_API_KEY,
    });
    const res = await model.invoke(messages.map((m) => ({ role: m.role, content: m.content })));
    const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
    if (!text.trim()) throw new Error("empty completion from Groq");
    return text;
  },
  async analyzeImage() {
    throw new Error("Groq text model cannot analyze images (spec §17) — use a vision provider");
  },
};

// ---------------------------------------------------------------------------
// Gemini direct (text + vision)
// ---------------------------------------------------------------------------

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

function geminiClient(options?: ProviderCallOptions) {
  return new ChatGoogleGenerativeAI({
    model: options?.model || GEMINI_MODEL,
    temperature: options?.temperature ?? 0,
    maxRetries: 1,
    apiKey: process.env.GOOGLE_API_KEY,
  });
}

const geminiProvider: ModelProvider = {
  name: "gemini",
  supportsVision: true,
  async generate(messages, options = {}) {
    const res = await geminiClient(options).invoke(
      messages.map((m) => ({ role: m.role, content: m.content }))
    );
    const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
    if (!text.trim()) throw new Error("empty completion from Gemini");
    return text;
  },
  async analyzeImage(prompt, imageDataUrl, options = {}) {
    const res = await geminiClient(options).invoke([
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ]);
    const text = typeof res.content === "string" ? res.content : String(res.content ?? "");
    if (!text.trim()) throw new Error("empty vision completion from Gemini");
    return text;
  },
};

// ---------------------------------------------------------------------------
// z-ai gateway (GLM by Zhipu AI — text + vision; last-resort fallback)
// ---------------------------------------------------------------------------

type ZAIClient = Awaited<ReturnType<typeof ZAI.create>>;
let zaiClientPromise: Promise<ZAIClient> | null = null;

async function zaiClient(): Promise<ZAIClient> {
  if (!zaiClientPromise) {
    zaiClientPromise = ZAI.create();
  }
  return zaiClientPromise;
}

const zaiProvider: ModelProvider = {
  name: "zai",
  supportsVision: true,
  async generate(messages, options = {}) {
    // zaiComplete already retries once on gateway defaults.
    return zaiComplete(
      messages.map((m) => ({ role: m.role, content: m.content })),
      { temperature: options.temperature ?? 0 }
    );
  },
  async analyzeImage(prompt, imageDataUrl) {
    const zai = await zaiClient();
    const completion = await zai.chat.completions.createVision({
      // The SDK currently requires model in its TypeScript request type.
      // Override this if the configured Z.AI gateway uses a different vision model.
      model: process.env.ZAI_VISION_MODEL || "glm-4.5v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    const text = completion.choices[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("empty vision completion from the z-ai gateway");
    return text;
  },
};

// ---------------------------------------------------------------------------
// Registry + env-driven chain resolution (§54)
// ---------------------------------------------------------------------------

export const PROVIDERS: Record<ProviderName, ModelProvider> = {
  groq: groqProvider,
  gemini: geminiProvider,
  zai: zaiProvider,
};

export function providerLabel(name: ProviderName): string {
  return name === "zai" ? "zai-glm" : name;
}

export function providerModelLabel(name: ProviderName): string {
  if (name === "groq") return GROQ_CHAT_MODEL;
  if (name === "gemini") return GEMINI_MODEL;
  return "GLM (z-ai gateway)";
}

/** Agent keys accepted in env chain configuration. */
export type AgentChainKey =
  | "router"
  | "medical"
  | "medicine"
  | "personal"
  | "emergency"
  | "vision";

function envChain(base: string): ProviderName[] {
  const primary = (process.env[`${base}_PRIMARY`] || "").toLowerCase();
  const secondary = (process.env[`${base}_SECONDARY`] || "").toLowerCase();
  const fallback = (process.env[`${base}_FALLBACK`] || "").toLowerCase();
  const chain: ProviderName[] = [];
  for (const name of [primary, secondary, fallback]) {
    if (name === "groq" || name === "gemini" || name === "zai") {
      if (!chain.includes(name)) chain.push(name);
    }
  }
  // Defaults preserve the established MedSync chain (§54).
  if (chain.length === 0) {
    return base === "vision" ? ["gemini", "zai"] : ["groq", "gemini", "zai"];
  }
  return chain;
}

export function resolveChain(agentKey: AgentChainKey): ProviderName[] {
  switch (agentKey) {
    case "router":
      return envChain("MEDICAL"); // router delegates to agents; chain for its own messages
    case "medical":
      return envChain("MEDICAL");
    case "medicine":
      return envChain("MEDICATION");
    case "personal":
      return envChain("PERSONAL");
    case "emergency":
      return envChain("EMERGENCY");
    case "vision":
      return envChain("VISION");
  }
}

/**
 * Walk the provider chain for an agent: same prompt, different provider
 * (§30). Returns the first success plus chain metadata; throws only when
 * EVERY provider failed (the caller then returns the safe error, §29).
 */
export async function runProviderChain(
  agentKey: AgentChainKey,
  messages: ProviderMessage[],
  options: ProviderCallOptions & { visionImage?: string } = {}
): Promise<ProviderResult> {
  const chain = resolveChain(agentKey);
  const started = Date.now();
  let lastError: unknown = null;

  for (let i = 0; i < chain.length; i++) {
    const provider = PROVIDERS[chain[i]];
    if (options.visionImage && !provider.supportsVision) continue; // §17/31
    // P1-45 — the circuit breaker skips providers that are failing hard,
    // so failover to the next healthy provider happens without waiting for
    // yet another timeout on a dead endpoint.
    if (!breakerCanAttempt(provider.name)) {
      console.warn(
        `[ai-gateway] ${agentKey}: skipping provider ${provider.name} (circuit breaker open).`
      );
      continue;
    }
    try {
      const timeoutMs = options.visionImage ? PROVIDER_VISION_TIMEOUT_MS : PROVIDER_TIMEOUT_MS;
      const output = options.visionImage
        ? await withTimeout(
            provider.analyzeImage(
              messages.find((m) => m.role === "user")?.content || "",
              options.visionImage,
              options
            ),
            timeoutMs,
            `vision call via ${provider.name}`
          )
        : await withTimeout(
            provider.generate(messages, options),
            timeoutMs,
            `call via ${provider.name}`
          );
      breakerRecordSuccess(provider.name);
      return {
        output,
        provider: provider.name,
        model: providerModelLabel(provider.name),
        latencyMs: Date.now() - started,
        fallbackUsed: i > 0,
      };
    } catch (err) {
      lastError = err;
      breakerRecordFailure(provider.name, err);
      console.warn(
        `[ai-gateway] ${agentKey}: provider ${provider.name} failed (${
          (err as Error).message
        }); ${i < chain.length - 1 ? "trying next provider" : "chain exhausted"}.`
      );
    }
  }
  throw lastError instanceof Error ? lastError : new Error("all providers failed");
}
