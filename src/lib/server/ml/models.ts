/**
 * MEDSYNC-007 — Models (plan §16, §20–22: four-candidate comparison).
 *
 * 1. Baseline (modelType "baseline"): deterministic, fully interpretable rule
 *    score adapted from the original riskHeuristic. It is the honesty floor —
 *    any trained model must beat it on the temporal test split to be promoted.
 *
 * 2. Logistic Regression (modelType "logistic-regression"): standardized
 *    features, class-balanced batch gradient descent with L2 regularization.
 *    Serialized to JSON in ModelArtifact so prediction needs no retraining.
 *
 * 3. Random Forest (modelType "random-forest"): 60 classification trees on
 *    class-balanced bootstraps, greedy weighted-Gini splits, seeded feature
 *    subsampling (ceil(sqrt(d))) and quantile-thinned thresholds.
 *
 * 4. Gradient Boosting (modelType "gradient-boosting"): 60 rounds of
 *    logistic-loss boosting with depth-2 regression trees on residuals.
 *
 * Every random choice flows through the seeded mulberry32 RNG (seed 42) —
 * training is fully deterministic. No ML libraries: the trees are small
 * (12 features, <100 training rows), so they are implemented here and
 * serialized to plain JSON inside ModelArtifact.weights.
 */

import { FEATURE_NAMES, type FeatureVector } from "./features";

/** The four candidate modelTypes compared by the training pipeline. */
export type MLModelType = "baseline" | "logistic-regression" | "random-forest" | "gradient-boosting";

// ── Baseline ────────────────────────────────────────────────────────────────

export interface BaselineModel {
  kind: "baseline";
  version: string;
}

export function baselineScore(f: FeatureVector): number {
  let risk = 0.08;
  if (f.hour >= 20) risk += 0.18;
  else if (f.hour >= 17) risk += 0.12;
  else if (f.hour < 7) risk += 0.1;
  if (f.isWeekend) risk += 0.1;
  if (f.dosesPerDay >= 3) risk += 0.12;
  else if (f.dosesPerDay === 2) risk += 0.05;
  risk += Math.min(f.missedLast7d * 0.09, 0.36);
  risk += Math.min(f.slotMissStreak * 0.07, 0.21);
  if (f.adherenceRate7d < 0.5) risk += 0.12;
  else if (f.adherenceRate7d < 0.8) risk += 0.06;
  if (f.streak >= 7) risk -= 0.1;
  else if (f.streak >= 3) risk -= 0.05;
  if (f.avgDelay7d > 45) risk += 0.08;
  return Math.max(0.02, Math.min(0.97, Number(risk.toFixed(4))));
}

/** Rule-level deltas for honest baseline explanations. */
export function baselineExplanation(f: FeatureVector): { feature: string; contribution: number }[] {
  const parts: { feature: string; contribution: number }[] = [];
  if (f.hour >= 20) parts.push({ feature: "hour", contribution: 0.18 });
  else if (f.hour >= 17) parts.push({ feature: "hour", contribution: 0.12 });
  else if (f.hour < 7) parts.push({ feature: "hour", contribution: 0.1 });
  if (f.isWeekend) parts.push({ feature: "isWeekend", contribution: 0.1 });
  if (f.dosesPerDay >= 3) parts.push({ feature: "dosesPerDay", contribution: 0.12 });
  const missPart = Math.min(f.missedLast7d * 0.09, 0.36);
  if (missPart > 0) parts.push({ feature: "missedLast7d", contribution: missPart });
  const slotPart = Math.min(f.slotMissStreak * 0.07, 0.21);
  if (slotPart > 0) parts.push({ feature: "slotMissStreak", contribution: slotPart });
  if (f.adherenceRate7d < 0.5) parts.push({ feature: "adherenceRate7d", contribution: 0.12 });
  else if (f.adherenceRate7d < 0.8) parts.push({ feature: "adherenceRate7d", contribution: 0.06 });
  if (f.streak >= 7) parts.push({ feature: "streak", contribution: -0.1 });
  else if (f.streak >= 3) parts.push({ feature: "streak", contribution: -0.05 });
  if (f.avgDelay7d > 45) parts.push({ feature: "avgDelay7d", contribution: 0.08 });
  return parts.sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ── Logistic Regression ─────────────────────────────────────────────────────

export interface LogisticModel {
  kind: "logistic-regression";
  version: string;
  featureNames: typeof FEATURE_NAMES[number][];
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
}

export function trainLogisticRegression(
  X: number[][],
  y: (0 | 1)[],
  options: TrainOptions = {}
): LogisticModel {
  const epochs = options.epochs ?? 800;
  const lr = options.learningRate ?? 0.15;
  const l2 = options.l2 ?? 0.01;
  const n = X.length;
  const d = X[0]?.length ?? 0;

  // Standardization (train statistics only — no leakage).
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(1);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += X[i][j];
    mean[j] = s / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (X[i][j] - mean[j]) ** 2;
    std[j] = Math.sqrt(v / Math.max(1, n - 1)) || 1;
  }
  const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]));

  // Class-balanced weights.
  const pos = y.reduce((a, l) => a + l, 0);
  const neg = n - pos;
  const wPos = pos > 0 ? n / (2 * pos) : 1;
  const wNeg = neg > 0 ? n / (2 * neg) : 1;

  const weights = new Array(d).fill(0);
  let bias = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(d).fill(0);
    let gradB = 0;
    for (let i = 0; i < n; i++) {
      let z = bias;
      for (let j = 0; j < d; j++) z += weights[j] * Z[i][j];
      const p = sigmoid(z);
      const err = p - y[i];
      const w = y[i] === 1 ? wPos : wNeg;
      for (let j = 0; j < d; j++) gradW[j] += w * err * Z[i][j];
      gradB += w * err;
    }
    for (let j = 0; j < d; j++) weights[j] -= lr * (gradW[j] / n + l2 * weights[j]);
    bias -= lr * (gradB / n);
  }

  return {
    kind: "logistic-regression",
    version: "",
    featureNames: [...FEATURE_NAMES],
    mean,
    std,
    weights,
    bias,
  };
}

export function logisticPredict(model: LogisticModel, f: FeatureVector): number {
  const x = model.featureNames.map((name, j) => ((f as Record<string, number>)[name] - model.mean[j]) / model.std[j]);
  let z = model.bias;
  for (let j = 0; j < x.length; j++) z += model.weights[j] * x[j];
  return Number(Math.max(0.01, Math.min(0.99, sigmoid(z))).toFixed(4));
}

/** Signed contribution per feature (weight × standardized value) — the honest XAI basis. */
export function logisticContributions(model: LogisticModel, f: FeatureVector): { feature: string; contribution: number }[] {
  return model.featureNames
    .map((name, j) => {
      const z = ((f as Record<string, number>)[name] - model.mean[j]) / model.std[j];
      return { feature: name, contribution: Number((model.weights[j] * z).toFixed(4)) };
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
}

// ── Seeded RNG + shared tree helpers ────────────────────────────────────────

const DEFAULT_SEED = 42;
const DEFAULT_MAX_THRESHOLDS = 16;

/** Deterministic 32-bit RNG (mulberry32) — no Math.random anywhere in training. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ceil(sqrt(d)) distinct feature indices, sampled without replacement (seeded). */
function sampleFeatureSubset(d: number, rng: () => number): number[] {
  const k = Math.max(1, Math.ceil(Math.sqrt(d)));
  const pool = Array.from({ length: d }, (_, i) => i);
  for (let i = 0; i < k && i < d; i++) {
    const j = i + Math.floor(rng() * (d - i));
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
  }
  return pool.slice(0, Math.min(k, d)).sort((a, b) => a - b);
}

/** Indices over `count` candidates, quantile-thinned to ≤ cap (endpoints kept). */
function thinnedIndices(count: number, cap: number): number[] {
  if (count <= cap) return Array.from({ length: count }, (_, i) => i);
  const out: number[] = [];
  for (let k = 0; k < cap; k++) {
    out.push(Math.min(count - 1, Math.round((k * (count - 1)) / (cap - 1))));
  }
  return [...new Set(out)];
}

/** Midpoint split candidates for one feature (sorted unique values, thinned). */
function candidateThresholds(values: number[], cap: number): number[] {
  const uniq = Array.from(new Set(values)).sort((a, b) => a - b);
  const mids: number[] = [];
  for (let j = 0; j + 1 < uniq.length; j++) mids.push((uniq[j] + uniq[j + 1]) / 2);
  return thinnedIndices(mids.length, cap).map((i) => mids[i]);
}

/** Gini impurity of a node with `pos` positives out of `total`. */
function gini(pos: number, total: number): number {
  if (total === 0) return 0;
  const p = pos / total;
  return 2 * p * (1 - p);
}

// ── Random Forest ───────────────────────────────────────────────────────────

/** One decision-tree node — fully JSON-serializable. */
export interface RFTreeNode {
  kind: "leaf" | "split";
  /** Leaf: Laplace-smoothed positive rate (pos+1)/(n+2). 0 on splits. */
  probability: number;
  /** Split: feature index (-1 on leaves). */
  feature: number;
  /** Split: go left when feature value <= threshold. */
  threshold: number;
  /** Split: weighted Gini reduction achieved here (importance bookkeeping). */
  gain: number;
  left: RFTreeNode | null;
  right: RFTreeNode | null;
}

export interface RFTree {
  root: RFTreeNode;
}

export interface RandomForestModel {
  kind: "random-forest";
  version: string;
  featureNames: typeof FEATURE_NAMES[number][];
  trees: RFTree[];
}

function rfLeaf(indices: number[], y: (0 | 1)[]): RFTreeNode {
  let pos = 0;
  for (const i of indices) pos += y[i];
  return {
    kind: "leaf",
    probability: (pos + 1) / (indices.length + 2),
    feature: -1,
    threshold: 0,
    gain: 0,
    left: null,
    right: null,
  };
}

/** Greedy binary splits minimizing weighted Gini; leaves when pure/depth/no gain. */
function buildClassificationTree(
  X: number[][],
  y: (0 | 1)[],
  indices: number[],
  depth: number,
  opts: { maxDepth: number; minLeafSize: number; maxThresholds: number },
  rng: () => number
): RFTreeNode {
  const n = indices.length;
  if (n === 0 || n < 2 * opts.minLeafSize || depth >= opts.maxDepth) return rfLeaf(indices, y);
  let pos = 0;
  for (const i of indices) pos += y[i];
  if (pos === 0 || pos === n) return rfLeaf(indices, y); // pure node

  const d = X[0]?.length ?? 0;
  const features = sampleFeatureSubset(d, rng);
  const parentGini = gini(pos, n);

  let best: { feature: number; threshold: number; gain: number; left: number[]; right: number[] } | null = null;
  for (const f of features) {
    for (const t of candidateThresholds(indices.map((i) => X[i][f]), opts.maxThresholds)) {
      const left: number[] = [];
      const right: number[] = [];
      let lPos = 0;
      for (const i of indices) {
        if (X[i][f] <= t) {
          left.push(i);
          lPos += y[i];
        } else {
          right.push(i);
        }
      }
      if (left.length < opts.minLeafSize || right.length < opts.minLeafSize) continue;
      const rPos = pos - lPos;
      const weighted =
        (left.length / n) * gini(lPos, left.length) + (right.length / n) * gini(rPos, right.length);
      const gain = parentGini - weighted;
      if (best === null || gain > best.gain + 1e-12) {
        best = { feature: f, threshold: t, gain, left, right };
      }
    }
  }
  if (best === null || best.gain <= 1e-12) return rfLeaf(indices, y);

  return {
    kind: "split",
    probability: 0,
    feature: best.feature,
    threshold: best.threshold,
    gain: best.gain,
    left: buildClassificationTree(X, y, best.left, depth + 1, opts, rng),
    right: buildClassificationTree(X, y, best.right, depth + 1, opts, rng),
  };
}

/** Class-balanced bootstrap: n/2 positives + n/2 negatives with replacement. */
function balancedBootstrap(n: number, y: (0 | 1)[], rng: () => number): number[] {
  const posIdx: number[] = [];
  const negIdx: number[] = [];
  for (let i = 0; i < n; i++) (y[i] === 1 ? posIdx : negIdx).push(i);
  if (posIdx.length === 0 || negIdx.length === 0) {
    // A class is empty → uniform bootstrap fallback.
    const sample: number[] = [];
    for (let k = 0; k < n; k++) sample.push(Math.floor(rng() * n));
    return sample;
  }
  const half = Math.floor(n / 2);
  const sample: number[] = [];
  for (let k = 0; k < half; k++) sample.push(posIdx[Math.floor(rng() * posIdx.length)]);
  for (let k = 0; k < half; k++) sample.push(negIdx[Math.floor(rng() * negIdx.length)]);
  return sample;
}

export interface RandomForestTrainOptions {
  nTrees?: number;
  maxDepth?: number;
  minLeafSize?: number;
  maxThresholds?: number;
  seed?: number;
}

export function trainRandomForest(
  X: number[][],
  y: (0 | 1)[],
  options: RandomForestTrainOptions = {}
): RandomForestModel {
  const nTrees = options.nTrees ?? 60;
  const maxDepth = options.maxDepth ?? 4;
  const minLeafSize = options.minLeafSize ?? 2;
  const maxThresholds = options.maxThresholds ?? DEFAULT_MAX_THRESHOLDS;
  const rng = mulberry32(options.seed ?? DEFAULT_SEED);
  const n = X.length;
  const trees: RFTree[] = [];
  if (n === 0) {
    return { kind: "random-forest", version: "", featureNames: [...FEATURE_NAMES], trees };
  }
  const opts = { maxDepth, minLeafSize, maxThresholds };
  for (let t = 0; t < nTrees; t++) {
    const boot = balancedBootstrap(n, y, rng);
    trees.push({ root: buildClassificationTree(X, y, boot, 0, opts, rng) });
  }
  return { kind: "random-forest", version: "", featureNames: [...FEATURE_NAMES], trees };
}

function rfTreeProbability(root: RFTreeNode, x: number[]): number {
  let cur = root;
  while (cur.kind === "split" && cur.left && cur.right) {
    cur = x[cur.feature] <= cur.threshold ? cur.left : cur.right;
  }
  return cur.probability;
}

/** Mean of tree probabilities, clamped to [0.01, 0.99]. */
export function randomForestPredict(model: RandomForestModel, f: FeatureVector): number {
  if (model.trees.length === 0) return 0.5;
  const x = model.featureNames.map((name) => (f as Record<string, number>)[name]);
  let sum = 0;
  for (const t of model.trees) sum += rfTreeProbability(t.root, x);
  return Number(Math.max(0.01, Math.min(0.99, sum / model.trees.length)).toFixed(4));
}

/** Global feature importance: total weighted-Gini reduction per feature, normalized to 1. */
export function randomForestImportance(model: RandomForestModel): { feature: string; importance: number }[] {
  const totals = new Array<number>(model.featureNames.length).fill(0);
  const walk = (node: RFTreeNode): void => {
    if (node.kind !== "split") return;
    if (node.feature >= 0 && node.feature < totals.length) totals[node.feature] += node.gain;
    if (node.left) walk(node.left);
    if (node.right) walk(node.right);
  };
  for (const t of model.trees) walk(t.root);
  const sum = totals.reduce((a, b) => a + b, 0);
  return model.featureNames
    .map((feature, j) => ({ feature, importance: sum > 0 ? Number((totals[j] / sum).toFixed(4)) : 0 }))
    .sort((a, b) => b.importance - a.importance || a.feature.localeCompare(b.feature));
}

// ── Gradient Boosting (binary logistic loss) ────────────────────────────────

export interface GBTreeNode {
  kind: "leaf" | "split";
  /** Leaf: mean residual clamped to [-2, 2]. 0 on splits. */
  value: number;
  /** Split: feature index (-1 on leaves). */
  feature: number;
  /** Split: go left when feature value <= threshold. */
  threshold: number;
  /** Split: SSE (MSE × n) reduction achieved here (importance bookkeeping). */
  gain: number;
  left: GBTreeNode | null;
  right: GBTreeNode | null;
}

export interface GBTree {
  root: GBTreeNode;
}

export interface GradientBoostingModel {
  kind: "gradient-boosting";
  version: string;
  featureNames: typeof FEATURE_NAMES[number][];
  base: number;
  learningRate: number;
  trees: GBTree[];
}

function gbLeaf(indices: number[], residuals: number[]): GBTreeNode {
  if (indices.length === 0) {
    return { kind: "leaf", value: 0, feature: -1, threshold: 0, gain: 0, left: null, right: null };
  }
  let sum = 0;
  for (const i of indices) sum += residuals[i];
  const mean = sum / indices.length;
  return {
    kind: "leaf",
    value: Math.max(-2, Math.min(2, mean)),
    feature: -1,
    threshold: 0,
    gain: 0,
    left: null,
    right: null,
  };
}

function sse(indices: number[], residuals: number[]): number {
  if (indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += residuals[i];
  const mean = sum / indices.length;
  let s = 0;
  for (const i of indices) s += (residuals[i] - mean) ** 2;
  return s;
}

/** Regression tree with MSE (SSE-reduction) splits on raw features. */
function buildRegressionTree(
  X: number[][],
  residuals: number[],
  indices: number[],
  depth: number,
  opts: { maxDepth: number; minLeafSize: number; maxThresholds: number },
  rng: () => number
): GBTreeNode {
  const n = indices.length;
  if (n === 0 || n < 2 * opts.minLeafSize || depth >= opts.maxDepth) return gbLeaf(indices, residuals);

  const d = X[0]?.length ?? 0;
  const features = sampleFeatureSubset(d, rng);
  const parentSse = sse(indices, residuals);

  let best: { feature: number; threshold: number; gain: number; left: number[]; right: number[] } | null = null;
  for (const f of features) {
    for (const t of candidateThresholds(indices.map((i) => X[i][f]), opts.maxThresholds)) {
      const left: number[] = [];
      const right: number[] = [];
      for (const i of indices) (X[i][f] <= t ? left : right).push(i);
      if (left.length < opts.minLeafSize || right.length < opts.minLeafSize) continue;
      const gain = parentSse - (sse(left, residuals) + sse(right, residuals));
      if (best === null || gain > best.gain + 1e-12) {
        best = { feature: f, threshold: t, gain, left, right };
      }
    }
  }
  if (best === null || best.gain <= 1e-12) return gbLeaf(indices, residuals);

  return {
    kind: "split",
    value: 0,
    feature: best.feature,
    threshold: best.threshold,
    gain: best.gain,
    left: buildRegressionTree(X, residuals, best.left, depth + 1, opts, rng),
    right: buildRegressionTree(X, residuals, best.right, depth + 1, opts, rng),
  };
}

export interface GradientBoostingTrainOptions {
  nRounds?: number;
  learningRate?: number;
  maxDepth?: number;
  minLeafSize?: number;
  maxThresholds?: number;
  seed?: number;
}

export function trainGradientBoosting(
  X: number[][],
  y: (0 | 1)[],
  options: GradientBoostingTrainOptions = {}
): GradientBoostingModel {
  const nRounds = options.nRounds ?? 60;
  const learningRate = options.learningRate ?? 0.1;
  const maxDepth = options.maxDepth ?? 2;
  const minLeafSize = options.minLeafSize ?? 2;
  const maxThresholds = options.maxThresholds ?? DEFAULT_MAX_THRESHOLDS;
  const seed = options.seed ?? DEFAULT_SEED;
  const n = X.length;
  const trees: GBTree[] = [];
  const model: GradientBoostingModel = {
    kind: "gradient-boosting",
    version: "",
    featureNames: [...FEATURE_NAMES],
    base: 0,
    learningRate,
    trees,
  };
  if (n === 0) return model;

  // Base log-odds of the train positives (clamped to stay finite).
  const pos = y.reduce((a: number, l) => a + l, 0);
  const p = Math.min(1 - 1e-6, Math.max(1e-6, pos / n));
  model.base = Math.max(-6, Math.min(6, Math.log(p / (1 - p))));

  const rng = mulberry32(seed);
  const opts = { maxDepth, minLeafSize, maxThresholds };
  const F = new Array<number>(n).fill(model.base);
  const allIndices = Array.from({ length: n }, (_, i) => i);
  for (let round = 0; round < nRounds; round++) {
    const residuals = F.map((fv, i) => y[i] - sigmoid(fv));
    const tree: GBTree = { root: buildRegressionTree(X, residuals, allIndices, 0, opts, rng) };
    trees.push(tree);
    for (let i = 0; i < n; i++) F[i] += learningRate * gbTreeValue(tree.root, X[i]);
  }
  return model;
}

function gbTreeValue(root: GBTreeNode, x: number[]): number {
  let cur = root;
  while (cur.kind === "split" && cur.left && cur.right) {
    cur = x[cur.feature] <= cur.threshold ? cur.left : cur.right;
  }
  return cur.value;
}

/** sigmoid(F) with F = base + learningRate × Σ trees, clamped to [0.01, 0.99]. */
export function gbPredict(model: GradientBoostingModel, f: FeatureVector): number {
  const x = model.featureNames.map((name) => (f as Record<string, number>)[name]);
  let acc = model.base;
  for (const t of model.trees) acc += model.learningRate * gbTreeValue(t.root, x);
  return Number(Math.max(0.01, Math.min(0.99, sigmoid(acc))).toFixed(4));
}

/** Global feature importance: accumulated split MSE reduction per feature, normalized to 1. */
export function gbImportance(model: GradientBoostingModel): { feature: string; importance: number }[] {
  const totals = new Array<number>(model.featureNames.length).fill(0);
  const walk = (node: GBTreeNode): void => {
    if (node.kind !== "split") return;
    if (node.feature >= 0 && node.feature < totals.length) totals[node.feature] += node.gain;
    if (node.left) walk(node.left);
    if (node.right) walk(node.right);
  };
  for (const t of model.trees) walk(t.root);
  const sum = totals.reduce((a, b) => a + b, 0);
  return model.featureNames
    .map((feature, j) => ({ feature, importance: sum > 0 ? Number((totals[j] / sum).toFixed(4)) : 0 }))
    .sort((a, b) => b.importance - a.importance || a.feature.localeCompare(b.feature));
}
