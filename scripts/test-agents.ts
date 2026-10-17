/**
 * Live test: all 6 agent endpoints + translate through the per-agent
 * provider chain (Groq → Gemini direct → z-ai gateway), with latency.
 * Run: bun run scripts/test-agents.ts
 */
const BASE = process.env.BASE_URL || "http://localhost:3000";

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@medsync.ai", password: "demo1234" }),
  });
  const j = await r.json();
  return j.token || j.user?.token;
}

async function hit(name: string, path: string, body: unknown, token: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const ms = Date.now() - t0;
    const j = await r.json().catch(() => ({}));
    const out = j.output || j.translatedText || j.message || j.error || JSON.stringify(j).slice(0, 120);
    console.log(`${String(r.status).padStart(3)} | ${String(ms).padStart(5)}ms | ${name.padEnd(22)} | ${String(out).slice(0, 90).replace(/\n/g, " ")}`);
  } catch (e) {
    console.log(`ERR | ${Date.now() - t0}ms | ${name} | ${(e as Error).message}`);
  }
}

const token = await login();
if (!token) { console.error("LOGIN FAILED"); process.exit(1); }
console.log("token OK\n");

await hit("medical", "/api/agents/medical", { input: "What are early signs of anemia?", user: { id: "x" }, language: "en" }, token);
await hit("emergency", "/api/agents/emergency", { input: "I have mild chest pain since yesterday", user: { id: "x" }, language: "en" }, token);
await hit("medicine", "/api/agents/medicine", { input: "Can I take ibuprofen with food?", user: { id: "x" }, language: "en" }, token);
await hit("personal-health", "/api/agents/personal-health", { input: "Suggest a light evening routine", user: { id: "x" }, language: "en" }, token);
await hit("router-medical", "/api/agents", { input: "What is diabetes?", user: { id: "x" }, language: "en" }, token);
await hit("router-emergency", "/api/agents", { input: "ألم شديد في الصدر", user: { id: "x" }, language: "ar" }, token);
await hit("translate", "/api/translate", { text: "Take your medication with water", targetLang: "es" }, token);
