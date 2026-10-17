/** GET /api/languages/supported — port of listSupportedLanguages. */
import { json } from "@/lib/server/http";
import { SUPPORTED_LANGUAGES } from "@/lib/server/language-config";

export async function GET() {
  return json({ languages: SUPPORTED_LANGUAGES });
}
