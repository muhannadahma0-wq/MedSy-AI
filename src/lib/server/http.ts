/** Small helpers shared by the API routes (Express res.status().json() equivalents). */

export function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

// ---------------------------------------------------------------------------
// MASTER AUDIT P0-49 / P0-50 / P1-54 — controlled error contract.
//
// Raw provider/exception messages NEVER reach the client: every failure is
// mapped to a closed set of error codes with a safe human-readable message.
// The technical detail stays in the server log (with a correlation id).
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "ACCOUNT_DISABLED"
  | "SESSION_INVALIDATED"
  | "MODEL_UNAVAILABLE"
  | "REQUEST_TIMEOUT"
  | "SAFETY_BLOCKED"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  ACCOUNT_DISABLED: 403,
  SESSION_INVALIDATED: 401,
  MODEL_UNAVAILABLE: 503,
  REQUEST_TIMEOUT: 504,
  SAFETY_BLOCKED: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INTERNAL_ERROR: 500,
};

/** Safe, schema-consistent error body: { success:false, error:{code,message,requestId} }. */
export function apiError(
  code: ApiErrorCode,
  message: string,
  requestId?: string,
  statusOverride?: number
): Response {
  return json(
    {
      success: false,
      error: {
        code,
        message,
        ...(requestId ? { requestId } : {}),
      },
    },
    statusOverride ?? STATUS_BY_CODE[code]
  );
}

/**
 * Error-code classifier for AI provider failures (P0-50): a provider error is
 * surfaced as MODEL_UNAVAILABLE / RATE_LIMITED / REQUEST_TIMEOUT — never as
 * the raw vendor message.
 */
export function classifyProviderError(err: unknown): ApiErrorCode {
  const msg = String((err as Error)?.message || "").toLowerCase();
  if (msg.includes("timeout") || msg.includes("aborted")) return "REQUEST_TIMEOUT";
  if (msg.includes("429") || msg.includes("rate limit")) return "RATE_LIMITED";
  return "MODEL_UNAVAILABLE";
}
