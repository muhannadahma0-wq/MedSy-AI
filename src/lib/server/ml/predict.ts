/**
 * MEDSYNC-007/009 — Prediction + Explainability (plan §16, §20–22).
 *
 * Scores a pending dose with the active registered model (any of the four
 * candidate types: baseline, logistic-regression, random-forest,
 * gradient-boosting), persists a RiskPrediction with the exact feature vector,
 * and builds an honest explanation:
 *   - baseline / logistic-regression → per-dose SIGNED contributions of the
 *     real feature values (explanationKind "per-dose");
 *   - random-forest / gradient-boosting → GLOBAL feature importance from the
 *     model itself (explanationKind "global-importance") — tree ensembles have
 *     no signed per-dose attribution, so the honest explanation is the model's
 *     own importance ranking, never a fabricated reason.
 */

import { db } from "@/lib/db";
import { riskLevelOf } from "../dose-events";
import { buildFeatures, FEATURE_LABELS, FEATURE_NAMES, type FeatureVector } from "./features";
import {
  baselineExplanation,
  baselineScore,
  logisticContributions,
  logisticPredict,
  randomForestPredict,
  randomForestImportance,
  gbPredict,
  gbImportance,
  type LogisticModel,
  type RandomForestModel,
  type GradientBoostingModel,
  type MLModelType,
} from "./models";

export interface ExplanationItem {
  feature: string;
  value: number;
  valueEn: string;
  valueAr: string;
  /** Per-dose: signed (positive → increases risk). Global-importance: unsigned importance in [0, 1]. */
  contribution: number;
  labelEn: string;
  labelAr: string;
}

export interface PredictionResult {
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  modelVersion: string;
  modelType: MLModelType;
  /** "per-dose" for baseline/LR (signed contributions); "global-importance" for tree ensembles. */
  explanationKind: "per-dose" | "global-importance";
  features: FeatureVector;
  explanation: ExplanationItem[];
  disclaimerEn: string;
  disclaimerAr: string;
}

export const DISCLAIMER_EN =
  "This is a behavioural estimate from your own dose history — not a medical judgement.";
export const DISCLAIMER_AR =
  "هذا تقدير سلوكي مبني على سجل جرعاتك الخاص — وليس حكماً طبياً.";

interface ActiveModelCache {
  at: number;
  modelType: MLModelType;
  version: string;
  logistic: LogisticModel | null;
  forest: RandomForestModel | null;
  boosting: GradientBoostingModel | null;
}

let activeModelCache: ActiveModelCache | null = null;
const CACHE_TTL_MS = 60_000;

/** Parses serialized weights, accepting them only when the `kind` matches. */
function parseModelWeights<T extends { kind: string }>(raw: string | null, kind: T["kind"]): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as T | null;
    return parsed && typeof parsed === "object" && parsed.kind === kind ? parsed : null;
  } catch {
    return null;
  }
}

async function getActiveModel(): Promise<ActiveModelCache> {
  if (activeModelCache && Date.now() - activeModelCache.at < CACHE_TTL_MS) {
    return activeModelCache;
  }
  const artifact = await db.modelArtifact.findFirst({
    where: { isActive: true },
    orderBy: { trainedAt: "desc" },
  });
  const fallback: ActiveModelCache = {
    at: Date.now(),
    modelType: "baseline",
    version: "baseline-v1",
    logistic: null,
    forest: null,
    boosting: null,
  };
  if (!artifact) {
    activeModelCache = fallback;
    return fallback;
  }

  let logistic: LogisticModel | null = null;
  let forest: RandomForestModel | null = null;
  let boosting: GradientBoostingModel | null = null;
  let modelType: MLModelType = "baseline";
  let version = "baseline-v1";
  if (artifact.modelType === "logistic-regression") {
    logistic = parseModelWeights<LogisticModel>(artifact.weights, "logistic-regression");
    if (logistic) {
      modelType = "logistic-regression";
      version = artifact.version;
    }
  } else if (artifact.modelType === "random-forest") {
    forest = parseModelWeights<RandomForestModel>(artifact.weights, "random-forest");
    if (forest) {
      modelType = "random-forest";
      version = artifact.version;
    }
  } else if (artifact.modelType === "gradient-boosting") {
    boosting = parseModelWeights<GradientBoostingModel>(artifact.weights, "gradient-boosting");
    if (boosting) {
      modelType = "gradient-boosting";
      version = artifact.version;
    }
  }

  activeModelCache = { at: Date.now(), modelType, version, logistic, forest, boosting };
  return activeModelCache;
}

/** Invalidates the cached active model (after training). */
export function invalidateActiveModelCache(): void {
  activeModelCache = null;
}

function formatValue(feature: string, v: number): { en: string; ar: string } {
  switch (feature) {
    case "isEvening":
      return v === 1 ? { en: "yes", ar: "نعم" } : { en: "no", ar: "لا" };
    case "isWeekend":
      return v === 1 ? { en: "yes", ar: "نعم" } : { en: "no", ar: "لا" };
    case "adherenceRate7d":
      return { en: `${Math.round(v * 100)}%`, ar: `${Math.round(v * 100)}٪` };
    case "avgDelay7d":
      return { en: `${v} min`, ar: `${v} دقيقة` };
    case "hour":
      return { en: `${String(v).padStart(2, "0")}:00`, ar: `${String(v).padStart(2, "0")}:00` };
    default:
      return { en: String(v), ar: String(v) };
  }
}

function toExplanationItems(
  parts: { feature: string; contribution: number }[],
  features: FeatureVector
): ExplanationItem[] {
  return parts
    .filter((p) => Math.abs(p.contribution) >= 0.01)
    .slice(0, 6)
    .map((p) => {
      const labels = FEATURE_LABELS[p.feature as keyof typeof FEATURE_LABELS];
      const value = features[p.feature as keyof FeatureVector] ?? 0;
      const fmt = formatValue(p.feature, value);
      return {
        feature: p.feature,
        value,
        valueEn: fmt.en,
        valueAr: fmt.ar,
        contribution: p.contribution,
        labelEn: labels?.en ?? p.feature,
        labelAr: labels?.ar ?? p.feature,
      };
    });
}

/** Maps a tree ensemble's global importance into ExplanationItem-shaped items. */
function globalImportanceExplanation(
  importance: { feature: string; importance: number }[],
  features: FeatureVector
): ExplanationItem[] {
  return toExplanationItems(
    importance.map((p) => ({ feature: p.feature, contribution: p.importance })),
    features
  );
}

export function explain(
  modelType: MLModelType,
  features: FeatureVector,
  models: {
    logistic: LogisticModel | null;
    forest: RandomForestModel | null;
    boosting: GradientBoostingModel | null;
  }
): ExplanationItem[] {
  // Tree ensembles → the model's own GLOBAL feature importance (unsigned, [0, 1]).
  if (modelType === "random-forest" && models.forest) {
    return globalImportanceExplanation(randomForestImportance(models.forest), features);
  }
  if (modelType === "gradient-boosting" && models.boosting) {
    return globalImportanceExplanation(gbImportance(models.boosting), features);
  }

  // Baseline / LR → signed per-dose contributions (existing behavior).
  const parts =
    modelType === "logistic-regression" && models.logistic
      ? logisticContributions(models.logistic, features)
      : baselineExplanation(features);
  return toExplanationItems(parts, features);
}

/**
 * Scores one pending dose event using the user's history strictly before it.
 * Returns the prediction without persisting (persist with persistPrediction).
 */
export async function scoreDoseEvent(params: {
  userId: string;
  doseEvent: { id: string; medicationId: string; scheduledAt: Date; slotTime: string };
}): Promise<PredictionResult> {
  const { userId, doseEvent } = params;

  const [meds, history] = await Promise.all([
    db.medication.findMany({ where: { userId } }),
    db.doseEvent.findMany({
      where: { userId, scheduledAt: { lt: doseEvent.scheduledAt } },
      orderBy: { scheduledAt: "asc" },
    }),
  ]);
  const med = meds.find((m) => m.id === doseEvent.medicationId);

  const features = buildFeatures(
    {
      userId,
      medicationId: doseEvent.medicationId,
      scheduledAt: doseEvent.scheduledAt,
      slotTime: doseEvent.slotTime,
    },
    history.map((h) => ({
      scheduledAt: h.scheduledAt,
      status: h.status,
      slotTime: h.slotTime,
      medicationId: h.medicationId,
      delayMinutes: h.delayMinutes,
    })),
    {
      startDate: med?.startDate ?? doseEvent.scheduledAt,
      dosageTimes: med?.dosageTimes ?? "[]",
    },
    meds.length
  );

  const active = await getActiveModel();
  let riskScore: number;
  let explanationKind: PredictionResult["explanationKind"] = "per-dose";
  if (active.modelType === "logistic-regression" && active.logistic) {
    riskScore = logisticPredict(active.logistic, features);
  } else if (active.modelType === "random-forest" && active.forest) {
    riskScore = randomForestPredict(active.forest, features);
    explanationKind = "global-importance";
  } else if (active.modelType === "gradient-boosting" && active.boosting) {
    riskScore = gbPredict(active.boosting, features);
    explanationKind = "global-importance";
  } else {
    riskScore = baselineScore(features);
  }

  return {
    riskScore,
    riskLevel: riskLevelOf(riskScore),
    modelVersion: active.version,
    modelType: active.modelType,
    explanationKind,
    features,
    explanation: explain(active.modelType, features, active),
    disclaimerEn: DISCLAIMER_EN,
    disclaimerAr: DISCLAIMER_AR,
  };
}

/**
 * Scores a pending dose, writes the RiskPrediction row and mirrors the score
 * onto the DoseEvent (riskScore / riskLevel / modelVersion).
 */
export async function persistPrediction(
  userId: string,
  doseEventId: string,
  mode: "shadow" | "live"
): Promise<PredictionResult | null> {
  const event = await db.doseEvent.findUnique({ where: { id: doseEventId } });
  if (!event || event.status !== "pending") return null;

  const prediction = await scoreDoseEvent({
    userId,
    doseEvent: {
      id: event.id,
      medicationId: event.medicationId,
      scheduledAt: event.scheduledAt,
      slotTime: event.slotTime,
    },
  });

  await db.riskPrediction.create({
    data: {
      userId,
      doseEventId: event.id,
      modelVersion: prediction.modelVersion,
      riskScore: prediction.riskScore,
      riskLevel: prediction.riskLevel,
      features: JSON.stringify(
        FEATURE_NAMES.reduce<Record<string, number>>((acc, f) => {
          acc[f] = prediction.features[f];
          return acc;
        }, {})
      ),
      explanation: JSON.stringify(prediction.explanation),
      mode,
    },
  });

  await db.doseEvent.update({
    where: { id: event.id },
    data: {
      riskScore: prediction.riskScore,
      riskLevel: prediction.riskLevel,
      modelVersion: prediction.modelVersion,
    },
  });

  return prediction;
}
