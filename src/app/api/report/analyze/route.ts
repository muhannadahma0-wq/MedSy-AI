/**
 * POST /api/report/analyze — port of reportAnalysis.js (generateAnalysis).
 * Accepts multipart/form-data with `file` (PDF or plain text) and `user` (JSON string),
 * exactly like the original multer-based route.
 *
 * Phase 12 hardening:
 *  - authenticated callers only; the report is always created for the CALLER
 *    (any `user` field from the form is overridden by the verified identity);
 *  - upload validation: 10 MB max, PDF or plain-text only (was unvalidated).
 */
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { generateAnalysis } from "@/lib/server/report-analysis";
import { withMetrics } from "@/lib/server/metrics";
import { hitRateLimit, tooManyRequests, LIMITS } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB (matches the plan's Phase 12 limit)

function isAllowedUpload(file: File): boolean {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return true;
  if (file.type.startsWith("text/")) return true;
  if (name.endsWith(".txt") || name.endsWith(".md")) return true;
  return false;
}

/**
 * MASTER AUDIT P1-48 — PDF magic-byte validation: the declared MIME type and
 * the file extension are both client-controlled, so a real PDF must also
 * START with the "%PDF-" signature before it enters the parsing pipeline.
 */
async function hasPdfMagicBytes(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
  return signature.every((byte, i) => head[i] === byte);
}

async function handler_POST(req: Request) {
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;

  // P1-48 — per-user upload rate limit (10 uploads / 10 min).
  const uploadDecision = hitRateLimit(`report-upload:user:${guard.id}`, LIMITS.upload);
  if (!uploadDecision.allowed) {
    return tooManyRequests(
      uploadDecision.retryAfterMs,
      "Too many report uploads. Please wait a few minutes and try again."
    );
  }

  let file: File | null = null;
  let language: string | null = null;

  try {
    const formData = await req.formData();
    const maybeFile = formData.get("file");
    if (maybeFile instanceof File) file = maybeFile;
    const maybeLang = formData.get("language");
    if (typeof maybeLang === "string") language = maybeLang;
  } catch {
    return json({ error: "Invalid form data" }, 400);
  }

  if (file) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: "File too large — the limit is 10 MB." }, 413);
    }
    if (!isAllowedUpload(file)) {
      return json({ error: "Unsupported file type — upload a PDF or plain-text report." }, 415);
    }
    const isPdfDeclared =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (isPdfDeclared && !(await hasPdfMagicBytes(file))) {
      // P1-48 — the content does not match the declared type: reject.
      return json({ error: "This file is not a valid PDF." }, 415);
    }
  }

  // The report is always owned by the authenticated caller.
  const userJson = JSON.stringify({ id: guard.id });

  const result = await generateAnalysis({ file, userJson, language });
  return json(result.body, result.status);
}

export const POST = withMetrics("POST /api/report/analyze", handler_POST);
