/**
 * GET /api/oauth/login — port of routes/oauth.js. Google OAuth requires
 * GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI which are not configured in this
 * sandbox; respond with a clear error instead of redirecting.
 */
import { json } from "@/lib/server/http";

export async function GET() {
  return json(
    {
      error: "Google OAuth is not configured",
      message:
        "This sandbox build has no GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI environment variables, so the Google Calendar flow cannot start. All other MedSync AI features work normally.",
    },
    503
  );
}
