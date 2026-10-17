/**
 * POST /api/ml/train — MEDSYNC-007 training endpoint (plan §16, §20–22).
 * Trains all four candidates — rule baseline, logistic regression, gradient
 * boosting and random forest — on the same temporal train split, evaluates
 * them on the same held-out test split, registers one artifact per candidate
 * and promotes evidence-based (beat-or-tie the baseline's temporal-test
 * ROC-AUC; ties broken by lower Brier, then model simplicity).
 * Returns the full comparison report.
 */
import { json } from "@/lib/server/http";
import { requireSelf } from "@/lib/server/jwt";
import { trainAndRegister } from "@/lib/server/ml/train";
import { invalidateActiveModelCache } from "@/lib/server/ml/predict";
import { withMetrics } from "@/lib/server/metrics";

async function handler_POST(req: Request) {
  // Phase 12 — authenticated operators only. Training is a global operation
  // (it reads the full multi-user dataset by design); the guard removes the
  // unauthenticated body-id fallback.
  const guard = await requireSelf(req);
  if (guard instanceof Response) return guard;
  void guard;
  try {
    const report = await trainAndRegister();
    invalidateActiveModelCache();
    return json({ success: true, report });
  } catch (err) {
    console.error("[ml/train] failed:", err);
    return json({ success: false, message: "Training failed" }, 500);
  }
}

export const POST = withMetrics("POST /api/ml/train", handler_POST);
