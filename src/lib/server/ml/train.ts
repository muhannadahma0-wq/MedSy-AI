/**
 * MEDSYNC-007 — Training pipeline (plan §16, §20–22: model comparison).
 *
 * - Dataset: resolved DoseEvents (labels: 1 = delayed|missed "not confirmed on
 *   time", 0 = taken on time). Pending/skipped events are excluded.
 * - Split: TEMPORAL (chronological 70/30) — never random, to answer RQ1 without
 *   leakage. All candidates are trained on exactly the same train split and
 *   evaluated on exactly the same held-out test split.
 * - Four candidates compared honestly:
 *     1. rule-based baseline (the honesty floor),
 *     2. logistic regression,
 *     3. gradient boosting (seeded trees, JSON-serialized),
 *     4. random forest (seeded trees, JSON-serialized).
 * - Metrics: ROC-AUC, PR-AUC, Brier, log-loss, calibration, confusion —
 *   accuracy is reported but never alone.
 * - Promotion is evidence-based: among candidates that beat-or-tie the
 *   baseline's temporal-test ROC-AUC, the best ROC-AUC wins; ties are broken
 *   by lower Brier, then by model simplicity
 *   (baseline < logistic-regression < gradient-boosting < random-forest).
 *   With insufficient data the baseline stays and no trained model is promoted.
 * - Honesty (plan §18): the report is marked datasetType "real-user-demo" and,
 *   below 200 resolved events, the promotion reason explicitly flags the small
 *   demo dataset ("pipeline validation, not clinical evidence").
 * - Model versioning (plan §22): one ModelArtifact row per candidate per run;
 *   only the promoted candidate carries isActive — stale active rows of ALL
 *   FOUR modelTypes are deactivated.
 */

import { db } from "@/lib/db";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { FEATURE_NAMES, buildUserDataset, type FeatureVector } from "./features";
import { evaluate, type ClassificationReport } from "./metrics";
import {
  baselineScore,
  trainLogisticRegression,
  logisticPredict,
  trainRandomForest,
  randomForestPredict,
  trainGradientBoosting,
  gbPredict,
  type LogisticModel,
  type RandomForestModel,
  type GradientBoostingModel,
  type MLModelType,
} from "./models";

export type ModelType = MLModelType;

export interface TrainReport {
  trainedAt: string;
  /** Honesty marker (plan §18): every row comes from real demo-user app usage. */
  datasetType: "real-user-demo";
  dataset: {
    users: number;
    resolvedEvents: number;
    positives: number;
    prevalence: number;
    trainRows: number;
    testRows: number;
    split: "temporal";
    trainUntil: string;
  };
  lowData: boolean;
  baseline: { version: string; metrics: ClassificationReport };
  logisticRegression: { version: string; metrics: ClassificationReport } | null;
  randomForest: { version: string; metrics: ClassificationReport } | null;
  gradientBoosting: { version: string; metrics: ClassificationReport } | null;
  /** Every evaluated candidate, fixed display order: baseline → LR → GB → RF. */
  candidates: { modelType: ModelType; version: string; metrics: ClassificationReport }[];
  promoted: { modelType: ModelType; version: string; reason: string };
}

const MIN_TRAIN_ROWS = 30;
const MIN_POSITIVES = 5;
const SMALL_DATASET_MAX = 200;

/** Simplicity order used for the final promotion tie-break. */
const SIMPLICITY_ORDER: ModelType[] = ["baseline", "logistic-regression", "gradient-boosting", "random-forest"];

interface TrainedCandidate {
  modelType: ModelType;
  version: string;
  metrics: ClassificationReport;
}

function fmtMetric(v: number | null): string {
  return v === null ? "n/a" : v.toFixed(4);
}

/** Phase 5 (plan §22): standalone metadata file for tooling — reads the
 *  active model's version/shape without loading any weights. */
async function exportModelMetadata(report: TrainReport): Promise<void> {
  try {
    const dir = path.join(process.cwd(), "ml-artifacts");
    await mkdir(dir, { recursive: true });
    const sum = (m: ClassificationReport) => ({
      rocAuc: m.rocAuc,
      prAuc: m.prAuc,
      brier: m.brier,
      logLoss: m.logLoss,
      n: m.n,
    });
    const metadata = {
      schema: "medsync-model-metadata/1",
      generatedAt: report.trainedAt,
      datasetType: report.datasetType,
      lowData: report.lowData,
      dataset: report.dataset,
      featureNames: FEATURE_NAMES,
      labelDefinition: "1 = dose not confirmed on time (delayed or missed)",
      validation: "temporal (chronological 70/30 split — never random)",
      promoted: {
        modelType: report.promoted.modelType,
        version: report.promoted.version,
        reason: report.promoted.reason,
      },
      candidates: report.candidates.map((c) => ({
        modelType: c.modelType,
        version: c.version,
        metrics: sum(c.metrics),
      })),
      honestyNote:
        "Metrics come from the demo cohort's real app usage, not a clinical trial. " +
        "Never present these numbers as clinical evidence (plan §18).",
    };
    await writeFile(
      path.join(dir, "model_metadata.json"),
      JSON.stringify(metadata, null, 2),
      "utf8"
    );
  } catch (err) {
    // Non-fatal: the DB registry remains the source of truth.
    console.warn("[ml/train] model_metadata.json export failed:", err);
  }
}

async function upsertArtifact(entry: {
  modelType: ModelType;
  version: string;
  weights: string;
  metrics: ClassificationReport;
  trainRows: number;
  testRows: number;
  isActive: boolean;
}): Promise<void> {
  await db.modelArtifact.upsert({
    where: { modelType_version: { modelType: entry.modelType, version: entry.version } },
    create: {
      modelType: entry.modelType,
      version: entry.version,
      weights: entry.weights,
      metrics: JSON.stringify(entry.metrics),
      trainRows: entry.trainRows,
      testRows: entry.testRows,
      isActive: entry.isActive,
      trainedAt: new Date(),
    },
    update: {
      weights: entry.weights,
      metrics: JSON.stringify(entry.metrics),
      trainRows: entry.trainRows,
      testRows: entry.testRows,
      isActive: entry.isActive,
      trainedAt: new Date(),
    },
  });
}

export async function trainAndRegister(): Promise<TrainReport> {
  // 1. Assemble the multi-user dataset in chronological order.
  const users = await db.user.findMany({ select: { id: true } });
  const rows: { scheduledAt: Date; features: FeatureVector; label: 0 | 1 }[] = [];
  for (const u of users) {
    const ds = await buildUserDataset(u.id);
    for (const r of ds) {
      if (r.label === null) continue;
      rows.push({ scheduledAt: r.scheduledAt, features: r.features, label: r.label });
    }
  }
  rows.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  const resolved = rows.length;
  const positives = rows.reduce((a, r) => a + r.label, 0);
  const lowData = resolved < MIN_TRAIN_ROWS || positives < MIN_POSITIVES;

  // 2. Temporal split (70/30) — identical for every candidate.
  const trainSize = Math.max(1, Math.floor(resolved * 0.7));
  const train = rows.slice(0, trainSize);
  const test = rows.slice(trainSize);

  const toX = (data: typeof rows) => data.map((r) => FEATURE_NAMES.map((f) => r.features[f]));
  const toY = (data: typeof rows) => data.map((r) => r.label);

  // 3. Baseline evaluated on the test set.
  const baselineTestScores = test.map((r) => baselineScore(r.features));
  const baselineMetrics = evaluate(baselineTestScores, toY(test));

  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const baselineVersion = "baseline-v1";

  // 4. Train every candidate on the SAME train split (trees see train only).
  let lr: LogisticModel | null = null;
  let lrMetrics: ClassificationReport | null = null;
  let lrVersion = "";
  let rf: RandomForestModel | null = null;
  let rfMetrics: ClassificationReport | null = null;
  let rfVersion = "";
  let gb: GradientBoostingModel | null = null;
  let gbMetrics: ClassificationReport | null = null;
  let gbVersion = "";
  if (train.length > 0) {
    const lrTrained = trainLogisticRegression(toX(train), toY(train));
    lrVersion = `lr-v${stamp}`;
    lrTrained.version = lrVersion;
    lr = lrTrained;
    lrMetrics = evaluate(test.map((r) => logisticPredict(lrTrained, r.features)), toY(test));

    const rfTrained = trainRandomForest(toX(train), toY(train));
    rfVersion = `rf-v${stamp}`;
    rfTrained.version = rfVersion;
    rf = rfTrained;
    rfMetrics = evaluate(test.map((r) => randomForestPredict(rfTrained, r.features)), toY(test));

    const gbTrained = trainGradientBoosting(toX(train), toY(train));
    gbVersion = `gb-v${stamp}`;
    gbTrained.version = gbVersion;
    gb = gbTrained;
    gbMetrics = evaluate(test.map((r) => gbPredict(gbTrained, r.features)), toY(test));
  }

  // 5. Candidate table in the fixed display order (baseline → LR → GB → RF).
  const candidates: TrainedCandidate[] = [
    { modelType: "baseline", version: baselineVersion, metrics: baselineMetrics },
  ];
  if (lr && lrMetrics) candidates.push({ modelType: "logistic-regression", version: lrVersion, metrics: lrMetrics });
  if (gb && gbMetrics) candidates.push({ modelType: "gradient-boosting", version: gbVersion, metrics: gbMetrics });
  if (rf && rfMetrics) candidates.push({ modelType: "random-forest", version: rfVersion, metrics: rfMetrics });
  candidates.sort((a, b) => SIMPLICITY_ORDER.indexOf(a.modelType) - SIMPLICITY_ORDER.indexOf(b.modelType));

  // 6. Evidence-based, honest promotion.
  const smallDatasetNote =
    resolved < SMALL_DATASET_MAX
      ? " Small demo dataset — results are pipeline validation, not clinical evidence."
      : "";

  let promoted: TrainReport["promoted"];
  if (lowData) {
    promoted = {
      modelType: "baseline",
      version: baselineVersion,
      reason:
        `Insufficient labelled data (${resolved} resolved events, ${positives} positives) — the deterministic baseline stays active ` +
        `until the minimum (${MIN_TRAIN_ROWS} rows / ${MIN_POSITIVES} positives) is met. ` +
        `All candidates were trained and evaluated for the report, but none was promoted.${smallDatasetNote}`,
    };
  } else {
    // Eligible: beat-or-tie the baseline's temporal-test ROC-AUC.
    // (If the baseline ROC-AUC is unrankable — single-class test set — any
    // rankable candidate is eligible; otherwise a null ROC-AUC is not.)
    const eligible = candidates.filter((c) => {
      if (c.metrics.rocAuc === null) return false;
      if (baselineMetrics.rocAuc === null) return true;
      return c.metrics.rocAuc >= baselineMetrics.rocAuc;
    });

    if (eligible.length === 0) {
      promoted = {
        modelType: "baseline",
        version: baselineVersion,
        reason:
          `Baseline kept: no candidate produced a comparable ROC-AUC on the temporal test set. ` +
          `No promotion without evidence.${smallDatasetNote}`,
      };
    } else {
      const winner = [...eligible].sort((a, b) => {
        const roc = (b.metrics.rocAuc ?? -1) - (a.metrics.rocAuc ?? -1); // higher ROC-AUC first
        if (roc !== 0) return roc;
        const brier = a.metrics.brier - b.metrics.brier; // lower Brier second
        if (brier !== 0) return brier;
        return SIMPLICITY_ORDER.indexOf(a.modelType) - SIMPLICITY_ORDER.indexOf(b.modelType); // simpler last
      })[0];

      if (winner.modelType === "baseline") {
        // Either nothing beat-or-tied the baseline, or a trained model tied the
        // ROC-AUC but lost the Brier/simplicity tie-breaks.
        const trained = candidates.filter((c) => c.modelType !== "baseline" && c.metrics.rocAuc !== null);
        const tiedBest = trained
          .filter((c) => c.metrics.rocAuc === baselineMetrics.rocAuc)
          .sort((a, b) => a.metrics.brier - b.metrics.brier)[0];
        const bestTrained = [...trained].sort(
          (a, b) => (b.metrics.rocAuc ?? -1) - (a.metrics.rocAuc ?? -1)
        )[0];
        promoted = {
          modelType: "baseline",
          version: baselineVersion,
          reason: tiedBest
            ? `Baseline kept: ${tiedBest.modelType} tied the temporal test ROC-AUC ` +
              `(${fmtMetric(tiedBest.metrics.rocAuc)} vs ${fmtMetric(baselineMetrics.rocAuc)}) but lost the ` +
              `Brier/simplicity tie-break (Brier ${fmtMetric(tiedBest.metrics.brier)} vs ` +
              `${fmtMetric(baselineMetrics.brier)}). No promotion without evidence.${smallDatasetNote}`
            : `Baseline kept: temporal test ROC-AUC ${fmtMetric(baselineMetrics.rocAuc)} — no trained model ` +
              `beat-or-tied it` +
              (bestTrained
                ? ` (best trained: ${bestTrained.modelType} at ${fmtMetric(bestTrained.metrics.rocAuc)})`
                : "") +
              `. No promotion without evidence.${smallDatasetNote}`,
        };
      } else {
        promoted = {
          modelType: winner.modelType,
          version: winner.version,
          reason:
            `Promoted ${winner.modelType} (${winner.version}): temporal test ROC-AUC ` +
            `${fmtMetric(winner.metrics.rocAuc)} ≥ baseline ${fmtMetric(baselineMetrics.rocAuc)} ` +
            `(Brier ${fmtMetric(winner.metrics.brier)} vs ${fmtMetric(baselineMetrics.brier)}; ` +
            `PR-AUC ${fmtMetric(winner.metrics.prAuc)} vs ${fmtMetric(baselineMetrics.prAuc)}).${smallDatasetNote}`,
        };
      }
    }
  }

  // 7. Persist one artifact per candidate; isActive only for the promoted one.
  await upsertArtifact({
    modelType: "baseline",
    version: baselineVersion,
    weights: JSON.stringify({ kind: "baseline" }),
    metrics: baselineMetrics,
    trainRows: train.length,
    testRows: test.length,
    isActive: promoted.modelType === "baseline",
  });

  const trainedArtifacts: {
    model: LogisticModel | RandomForestModel | GradientBoostingModel | null;
    modelType: ModelType;
    version: string;
    metrics: ClassificationReport | null;
  }[] = [
    { model: lr, modelType: "logistic-regression", version: lrVersion, metrics: lrMetrics },
    { model: gb, modelType: "gradient-boosting", version: gbVersion, metrics: gbMetrics },
    { model: rf, modelType: "random-forest", version: rfVersion, metrics: rfMetrics },
  ];
  for (const t of trainedArtifacts) {
    if (!t.model || !t.metrics) continue;
    await upsertArtifact({
      modelType: t.modelType,
      version: t.version,
      weights: JSON.stringify(t.model),
      metrics: t.metrics,
      trainRows: train.length,
      testRows: test.length,
      isActive: promoted.modelType === t.modelType,
    });
  }

  // 8. Deactivate stale active rows for ALL FOUR modelTypes (model versioning).
  const currentVersions: Partial<Record<ModelType, string>> = {
    baseline: baselineVersion,
    "logistic-regression": lr && lrMetrics ? lrVersion : undefined,
    "gradient-boosting": gb && gbMetrics ? gbVersion : undefined,
    "random-forest": rf && rfMetrics ? rfVersion : undefined,
  };
  for (const t of SIMPLICITY_ORDER) {
    const arts = await db.modelArtifact.findMany({ where: { modelType: t, isActive: true } });
    for (const a of arts) {
      const shouldStay = promoted.modelType === t && a.version === currentVersions[t];
      if (!shouldStay) {
        await db.modelArtifact.update({ where: { id: a.id }, data: { isActive: false } });
      }
    }
  }

  const finalReport: TrainReport = {
    trainedAt: new Date().toISOString(),
    datasetType: "real-user-demo",
    dataset: {
      users: users.length,
      resolvedEvents: resolved,
      positives,
      prevalence: resolved > 0 ? Number((positives / resolved).toFixed(4)) : 0,
      trainRows: train.length,
      testRows: test.length,
      split: "temporal",
      trainUntil: train.length > 0 ? train[train.length - 1].scheduledAt.toISOString() : new Date().toISOString(),
    },
    lowData,
    baseline: { version: baselineVersion, metrics: baselineMetrics },
    logisticRegression: lrMetrics ? { version: lrVersion, metrics: lrMetrics } : null,
    randomForest: rfMetrics ? { version: rfVersion, metrics: rfMetrics } : null,
    gradientBoosting: gbMetrics ? { version: gbVersion, metrics: gbMetrics } : null,
    candidates: candidates.map((c) => ({ modelType: c.modelType, version: c.version, metrics: c.metrics })),
    promoted,
  };

  // Phase 5 (plan §22): standalone metadata artifact for tooling.
  await exportModelMetadata(finalReport);

  return finalReport;
}
