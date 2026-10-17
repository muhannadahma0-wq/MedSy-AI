/**
 * MASTER AUDIT P0-17/P0-18/P1-42 — one-shot modernization of the four
 * per-agent model modules. (Kept in scripts/ as the auditable record of the
 * change; run once with `bun run scripts/modernize-agents.ts`.)
 *
 * Per file:
 *  1. deprecated Groq chat model  llama-3.3-70b-versatile        → env-overridable openai/gpt-oss-120b
 *  2. deprecated Groq summary model meta-llama/llama-4-scout-…   → env-overridable openai/gpt-oss-20b
 *  3. universal "2-3 lines / 4-5 bullets" size caps              → structured-response guidance
 *  4. hardcoded 911 in the emergency prompt                      → locale-neutral wording
 *  Each agent keeps its OWN instances and settings (per-agent separation).
 */
import { readFileSync, writeFileSync } from "fs";

const AGENT_ENV: Record<string, [string, string]> = {
  "medical-model": ["MEDICAL_CHAT_MODEL", "MEDICAL_SUMMARY_MODEL"],
  "medicine-model": ["MEDICATION_CHAT_MODEL", "MEDICATION_SUMMARY_MODEL"],
  "personal-health-model": ["PERSONAL_CHAT_MODEL", "PERSONAL_SUMMARY_MODEL"],
  "emergency-model": ["EMERGENCY_CHAT_MODEL", "EMERGENCY_SUMMARY_MODEL"],
};

const CHAT_DEFAULT = "openai/gpt-oss-120b";
const SUMMARY_DEFAULT = "openai/gpt-oss-20b";

const SIZE_BLOCKS: Array<[RegExp, string]> = [
  [
    /      Conciseness: Your responses must be strictly size-limited:\n        Paragraphs: Maximum of 2-3 lines\.\n        Bulleted Lists: Maximum of 4-5 points\./,
    `      Response structure: answer the question directly first, then add short
      structured detail (brief points or a short list) only when it genuinely
      helps the patient. State uncertainty honestly when something is not
      settled, and recommend discussing significant findings with a qualified
      clinician when appropriate.`,
  ],
  [
    /          Response Style:\n              Keep responses clear, short, and actionable\.\n              Paragraphs: Max 2 lines\.\n              Bullet points: Max 3–4 items\./,
    `          Response Style:
              Lead with the safety assessment, then clear actionable steps.
              Structure over arbitrary length limits: short points when they
              help, but NEVER omit escalation guidance or honest uncertainty.`,
  ],
  [
    /        Response Style:\n          Keep responses short and structured:\n            Paragraphs: Max 2–3 lines\.\n            Bulleted lists: Max 4–5 items\.\n          Use clear, simple language suitable for all users\./,
    `        Response Style:
          Answer directly first, then short structured detail when it helps.
          Use clear, simple language suitable for all users.
          State uncertainty honestly and recommend professional follow-up
          when the topic warrants it.`,
  ],
];

for (const [file, [chatEnv, summaryEnv]] of Object.entries(AGENT_ENV)) {
  const path = `src/lib/server/models/${file}.ts`;
  let src = readFileSync(path, "utf8");
  const before = src;

  // 1+2. Model IDs → per-agent env-overridable constants.
  const constBlock = `
// MASTER AUDIT P0-17/P0-18 — deprecated llama-3.3-70b-versatile and
// meta-llama/llama-4-scout-17b-16e-instruct replaced by currently-supported
// Groq models. This agent keeps its OWN instances and settings (per-agent
// separation); each model id is env-overridable so swapping is a config
// change, never a code change.
const CHAT_MODEL = process.env.${chatEnv} || "${CHAT_DEFAULT}";
const SUMMARY_MODEL = process.env.${summaryEnv} || "${SUMMARY_DEFAULT}";
`;
  src = src.replace(
    /^const MODEL_NAME = ".*";$/m,
    (m) => m + constBlock
  );
  src = src.replace(/model: "llama-3\.3-70b-versatile",/g, "model: CHAT_MODEL,");
  src = src.replace(/model: "meta-llama\/llama-4-scout-17b-16e-instruct",/g, "model: SUMMARY_MODEL,");
  src = src.replace(
    /model: "llama-3\.3-70b-versatile \(LangChain\)"/g,
    "model: `${CHAT_MODEL} (LangChain)`"
  );

  // 3. Size caps → structure guidance (P1-42).
  let structureApplied = false;
  for (const [re, replacement] of SIZE_BLOCKS) {
    if (re.test(src)) {
      src = src.replace(re, replacement);
      structureApplied = true;
    }
  }

  // 4. Locale-neutral emergency wording (P0-26 — the gateway appends the
  //    locale-aware number line deterministically).
  src = src.replace(
    /call your local emergency number \(e\.g\., 911\) or seek immediate medical help\./g,
    "call your local emergency number right away or seek immediate medical help."
  );
  src = src.replace(
    /Please call your local emergency number \(e\.g\., 911\) or seek immediate medical help\./g,
    "Please call your local emergency number right away or seek immediate medical help."
  );

  // Header comment refresh.
  src = src.replace(
    / \*   - chat model:     Groq "llama-3\.3-70b-versatile"   \(answers\)\n \*   - summary model:  Groq "meta-llama\/llama-4-scout-17b-16e-instruct" \(memory\)/,
    ` *   - chat model:     Groq \`\${${chatEnv} || "${CHAT_DEFAULT}"}\`   (answers)\n *   - summary model:  Groq \`\${${summaryEnv} || "${SUMMARY_DEFAULT}"}\` (memory)`
  );
  // Gemini default label alignment (env wins; .env pins gemini-3.8-flash).
  src = src.replace(/model: process\.env\.GEMINI_MODEL \|\| "gemini-3\.6-flash"/g, 'model: process.env.GEMINI_MODEL || "gemini-3.8-flash"');

  if (src !== before) {
    writeFileSync(path, src);
    console.log(
      `${file}: updated (structure guidance applied: ${structureApplied})`
    );
  } else {
    console.log(`${file}: NO CHANGES (unexpected — inspect manually)`);
  }
}
