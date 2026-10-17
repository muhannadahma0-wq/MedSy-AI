/**
 * MEDSYNC-007 — Evaluation metrics.
 *
 * Per the research plan, "Accuracy" is never the only reported metric:
 * ROC-AUC (rank-based, tie-corrected), PR-AUC (average precision),
 * Brier score and a 10-bin calibration table are always computed.
 */

export interface CalibrationBin {
  binStart: number;
  binEnd: number;
  count: number;
  meanPredicted: number;
  observedRate: number;
}

export interface ClassificationReport {
  n: number;
  positives: number;
  prevalence: number;
  rocAuc: number | null; // null when a single class is present
  prAuc: number | null;
  brier: number;
  logLoss: number | null;
  accuracy: number | null; // secondary, threshold 0.5 — never alone
  confusion: { tp: number; fp: number; tn: number; fn: number } | null;
  calibration: CalibrationBin[];
}

/** Mann-Whitney ROC-AUC with mid-rank tie handling. */
export function rocAuc(scores: number[], labels: (0 | 1)[]): number | null {
  const pos = labels.filter((l) => l === 1).length;
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return null;

  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
  const ranks = new Array<number>(scores.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].s === order[i].s) j++;
    const avgRank = (i + j) / 2 + 1; // 1-based average rank
    for (let k = i; k <= j; k++) ranks[order[k].i] = avgRank;
    i = j + 1;
  }
  let rankSumPos = 0;
  for (let k = 0; k < labels.length; k++) if (labels[k] === 1) rankSumPos += ranks[k];
  const u = rankSumPos - (pos * (pos + 1)) / 2;
  return Number((u / (pos * neg)).toFixed(4));
}

/** Average-precision PR-AUC (step-wise, industry standard). */
export function prAuc(scores: number[], labels: (0 | 1)[]): number | null {
  const pos = labels.filter((l) => l === 1).length;
  if (pos === 0) return null;

  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  let tp = 0,
    fp = 0,
    auc = 0,
    prevRecall = 0;
  for (const { i } of order) {
    if (labels[i] === 1) tp++;
    else fp++;
    const precision = tp / (tp + fp);
    const recall = tp / pos;
    auc += (recall - prevRecall) * precision;
    prevRecall = recall;
  }
  return Number(auc.toFixed(4));
}

export function brierScore(scores: number[], labels: (0 | 1)[]): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s, i) => acc + (s - labels[i]) ** 2, 0);
  return Number((sum / scores.length).toFixed(4));
}

export function logLoss(scores: number[], labels: (0 | 1)[]): number | null {
  if (scores.length === 0) return null;
  const eps = 1e-12;
  let sum = 0;
  for (let i = 0; i < scores.length; i++) {
    const p = Math.min(1 - eps, Math.max(eps, scores[i]));
    sum += labels[i] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return Number((sum / scores.length).toFixed(4));
}

export function calibrationBins(scores: number[], labels: (0 | 1)[], bins = 10): CalibrationBin[] {
  const out: CalibrationBin[] = [];
  for (let b = 0; b < bins; b++) {
    const start = b / bins;
    const end = (b + 1) / bins;
    const idx = scores
      .map((s, i) => ({ s, i }))
      .filter(({ s, i }) => (b === bins - 1 ? s >= start && s <= end : s >= start && s < end) && (labels[i] === 0 || labels[i] === 1));
    const count = idx.length;
    out.push({
      binStart: Number(start.toFixed(2)),
      binEnd: Number(end.toFixed(2)),
      count,
      meanPredicted: count > 0 ? Number((idx.reduce((a, { s }) => a + s, 0) / count).toFixed(4)) : 0,
      observedRate: count > 0 ? Number((idx.reduce((a, { i }) => a + labels[i], 0) / count).toFixed(4)) : 0,
    });
  }
  return out;
}

export function evaluate(scores: number[], labels: (0 | 1)[], threshold = 0.5): ClassificationReport {
  const n = scores.length;
  const positives = labels.reduce((a, l) => a + l, 0);
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0;
  for (let i = 0; i < n; i++) {
    const pred = scores[i] >= threshold ? 1 : 0;
    if (pred === 1 && labels[i] === 1) tp++;
    else if (pred === 1 && labels[i] === 0) fp++;
    else if (pred === 0 && labels[i] === 0) tn++;
    else fn++;
  }
  return {
    n,
    positives,
    prevalence: n > 0 ? Number((positives / n).toFixed(4)) : 0,
    rocAuc: rocAuc(scores, labels),
    prAuc: prAuc(scores, labels),
    brier: brierScore(scores, labels),
    logLoss: logLoss(scores, labels),
    accuracy: n > 0 ? Number(((tp + tn) / n).toFixed(4)) : null,
    confusion: n > 0 ? { tp, fp, tn, fn } : null,
    calibration: calibrationBins(scores, labels),
  };
}
