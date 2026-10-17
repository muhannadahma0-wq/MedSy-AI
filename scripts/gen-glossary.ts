/**
 * Glossary generator (v5 review item 49) — renders docs/GLOSSARY.md from the
 * structured dictionary in src/lib/server/medical-terminology.ts.
 *
 * Generation is MANUAL by design: run this script only after editing the
 * dictionary (or after a reviewer flips `approved`/`reviewer` on entries):
 *
 *   bun run scripts/gen-glossary.ts
 */
import { writeFileSync } from "fs";
import { MEDICAL_TERMS } from "../src/lib/server/medical-terminology";

const HEADER = `# MedSync-AI — Arabic Medical Glossary (المسرد الطبي العربي)

> ⚠️ This file is GENERATED from \`src/lib/server/medical-terminology.ts\` by
> \`bun run scripts/gen-glossary.ts\` — do not edit it by hand. Edit the
> dictionary, then regenerate. Generation is manual; nothing updates this
> file automatically.

## Review workflow — how a term gets approved (v5 review item 49)

1. A **qualified human medical reviewer** (licensed physician, pharmacist, or
   certified medical translator) reviews a row below.
2. To sign off, set \`approved: true\` **and** \`reviewer: "<real name,
   credential>"\` on that entry in \`src/lib/server/medical-terminology.ts\`.
3. Regenerate this document: \`bun run scripts/gen-glossary.ts\`.
4. Commit both files together so the code and the document stay in sync.

### Honesty statement (لا تزكيات مُفبركة)

- \`approved: true\` is currently set **only on pure transliterations**
  (medication INNs such as أسبرين for aspirin) — Arabic renderings that are
  the standard, uncontroversial pharmacy forms.
- Even those entries carry \`reviewer: "pending-qualified-reviewer"\`:
  **no qualified human has signed off on any entry yet.** All other entries
  are \`approved: false\` and explicitly await qualified review.
- The \`context\` column documents when each term is used and register
  guidance — it is a review aid, not an approval.

سير العمل: يراجع مُراجعٌ طبي مؤهل الصفوف أدناه، ثم يضبط \`approved: true\`
مع \`reviewer: "<الاسم والاعتماد>"\` في \`src/lib/server/medical-terminology.ts\`
ويعيد توليد هذا الملف. لا يُعتبر أي مصطلح معتمداً فعلياً حتى تتم هذه المراجعة.

## Glossary (${Object.keys(MEDICAL_TERMS).length} terms)
`;

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const rows = Object.entries(MEDICAL_TERMS)
  .map(([en, entry]) => {
    const approved = entry.approved === true ? "✅ yes (transliteration)" : "⬜ no — pending review";
    const reviewer = entry.reviewer ?? "—";
    const context = entry.context ?? "";
    return `| ${escapeCell(en)} | ${escapeCell(entry.ar)} | ${escapeCell(context)} | ${approved} | ${escapeCell(reviewer)} |`;
  })
  .join("\n");

const doc =
  HEADER +
  "\n| English term | Arabic term (MSA) | Context | Approved | Reviewer |\n" +
  "|---|---|---|---|---|\n" +
  rows +
  "\n";

writeFileSync("docs/GLOSSARY.md", doc, "utf8");

const total = Object.keys(MEDICAL_TERMS).length;
const approvedCount = Object.values(MEDICAL_TERMS).filter((e) => e.approved === true).length;
console.log(`docs/GLOSSARY.md regenerated — ${total} terms (${approvedCount} transliteration-approved, ${total - approvedCount} awaiting qualified review).`);
