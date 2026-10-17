/** GET /api/translate/supported — port of getSupportedLanguages. */
import { json } from "@/lib/server/http";
import { SUPPORTED_LANGUAGES } from "@/lib/server/language-config";

export async function GET() {
  return json({ languages: SUPPORTED_LANGUAGES });
}
