import type { ModelMetrics } from "./types"
import { mulberry32, type Rng } from "./rng"

// ---------------------------------------------------------------------------
// PHYSICS-INSPIRED SINGLE-CELL FLOOD FUNCTION
// Couples rainfall -> runoff -> concentration -> drainage removal/surcharge.
// Used both to generate synthetic training data and as the ground truth the
// ML surrogate is validated against. Output is flood depth in centimetres.
// ---------------------------------------------------------------------------
export interface PhysicsFeatures {
  rainfall: number // mm/hr
  elevNorm: number // 0 (low) .. 1 (high)
  slope: number // percent
  imperviousness: number // 0-100
  drainCapacity: number // m^3/s
  drainUtil: number // ratio (1.0 = 100%)
  prevDepth: number // cm
  flowAccumNorm: number // 0..1
}

export function physicsFloodDepth(f: PhysicsFeatures): number {
  const runoff = f.rainfall * (0.12 + (f.imperviousness / 100) * 0.88)
  const flowFactor = 1 + f.flowAccumNorm * 2.0
  const slopeFactor = 1 / (1 + f.slope * 0.55)
  const drainFactor = clamp(f.drainUtil, 0.3, 2.4)
  const lowlandFactor = 1 + (1 - f.elevNorm) * 1.3
  const capacityRelief = 1 / (1 + f.drainCapacity * 0.08)
  let depth =
    runoff * 0.05 * flowFactor * slopeFactor * drainFactor * lowlandFactor * capacityRelief +
    f.prevDepth * 0.5
  return Math.max(0, depth)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ---------------------------------------------------------------------------
// SYNTHETIC TRAINING DATA GENERATOR
// Generates thousands of scenarios by varying inputs, grouped into "storms"
// so train/test can be split by storm (never leaking a storm across splits).
// ---------------------------------------------------------------------------
export const FEATURE_NAMES = [
  "rainfall",
  "elevNorm",
  "slope",
  "imperviousness",
  "drainCapacity",
  "drainUtil",
  "prevDepth",
  "flowAccumNorm",
]

export interface Dataset {
  X: number[][]
  y: number[]
  storm: number[]
}

export function generateSyntheticData(seed: number, storms = 120, perStorm = 12): Dataset {
  const rng = mulberry32(seed)
  const X: number[][] = []
  const y: number[] = []
  const storm: number[] = []
  for (let s = 0; s < storms; s++) {
    const stormRain = 10 + rng() * 120 // each storm has a characteristic intensity
    for (let i = 0; i < perStorm; i++) {
      const rainfall = clamp(stormRain + (rng() - 0.5) * 25, 2, 150)
      const elevNorm = rng()
      const slope = rng() * 4
      const imperviousness = 10 + rng() * 88
      const drainCapacity = 1 + rng() * 6
      const drainUtil = 0.3 + rng() * 2.0
      const prevDepth = rng() * 12
      const flowAccumNorm = rng()
      const f: PhysicsFeatures = {
        rainfall,
        elevNorm,
        slope,
        imperviousness,
        drainCapacity,
        drainUtil,
        prevDepth,
        flowAccumNorm,
      }
      const noise = (rng() - 0.5) * 2.5
      const depth = Math.max(0, physicsFloodDepth(f) + noise)
      X.push([rainfall, elevNorm, slope, imperviousness, drainCapacity, drainUtil, prevDepth, flowAccumNorm])
      y.push(depth)
      storm.push(s)
    }
  }
  return { X, y, storm }
}

// ---------------------------------------------------------------------------
// GRADIENT BOOSTED REGRESSION TREES  (a compact XGBoost-style ensemble)
// ---------------------------------------------------------------------------
interface TreeNode {
  leaf: boolean
  value?: number
  feature?: number
  threshold?: number
  left?: TreeNode
  right?: TreeNode
}

function buildTree(X: number[][], residuals: number[], idx: number[], depth: number, maxDepth: number, minSamples: number): TreeNode {
  const mean = idx.reduce((s, i) => s + residuals[i], 0) / idx.length
  if (depth >= maxDepth || idx.length < minSamples) {
    return { leaf: true, value: mean }
  }
  let bestFeat = -1
  let bestThr = 0
  let bestGain = 0
  const parentVar = variance(idx, residuals)
  const nFeat = X[0].length
  for (let fi = 0; fi < nFeat; fi++) {
    // Candidate thresholds from quantiles of this feature within the node.
    const vals = idx.map((i) => X[i][fi]).sort((a, b) => a - b)
    for (let q = 1; q < 8; q++) {
      const thr = vals[Math.floor((q / 8) * vals.length)]
      const left: number[] = []
      const right: number[] = []
      for (const i of idx) (X[i][fi] <= thr ? left : right).push(i)
      if (left.length < minSamples || right.length < minSamples) continue
      const gain =
        parentVar - (left.length / idx.length) * variance(left, residuals) - (right.length / idx.length) * variance(right, residuals)
      if (gain > bestGain) {
        bestGain = gain
        bestFeat = fi
        bestThr = thr
      }
    }
  }
  if (bestFeat < 0) return { leaf: true, value: mean }
  const left: number[] = []
  const right: number[] = []
  for (const i of idx) (X[i][bestFeat] <= bestThr ? left : right).push(i)
  return {
    leaf: false,
    feature: bestFeat,
    threshold: bestThr,
    left: buildTree(X, residuals, left, depth + 1, maxDepth, minSamples),
    right: buildTree(X, residuals, right, depth + 1, maxDepth, minSamples),
  }
}

function variance(idx: number[], y: number[]): number {
  if (idx.length === 0) return 0
  const mean = idx.reduce((s, i) => s + y[i], 0) / idx.length
  return idx.reduce((s, i) => s + (y[i] - mean) ** 2, 0) / idx.length
}

function predictTree(node: TreeNode, x: number[]): number {
  let n = node
  while (!n.leaf) {
    n = x[n.feature!] <= n.threshold! ? n.left! : n.right!
  }
  return n.value!
}

export class GradientBoostedModel {
  private trees: TreeNode[] = []
  private base = 0
  private lr: number
  constructor(private nTrees = 40, private maxDepth = 3, lr = 0.15, private minSamples = 6) {
    this.lr = lr
  }

  train(X: number[][], y: number[]) {
    this.base = y.reduce((s, v) => s + v, 0) / y.length
    const preds = new Array(y.length).fill(this.base)
    const allIdx = X.map((_, i) => i)
    for (let t = 0; t < this.nTrees; t++) {
      const residuals = y.map((v, i) => v - preds[i])
      const tree = buildTree(X, residuals, allIdx, 0, this.maxDepth, this.minSamples)
      this.trees.push(tree)
      for (let i = 0; i < preds.length; i++) preds[i] += this.lr * predictTree(tree, X[i])
    }
  }

  predict(x: number[]): number {
    let p = this.base
    for (const tree of this.trees) p += this.lr * predictTree(tree, x)
    return Math.max(0, p)
  }

  get treeCount() {
    return this.trees.length
  }
}

// ---------------------------------------------------------------------------
// TRAINING PIPELINE with storm-based train/test split + metrics
// ---------------------------------------------------------------------------
export interface TrainedModel {
  model: GradientBoostedModel
  metrics: ModelMetrics
}

export function trainFloodModel(seed: number): TrainedModel {
  const data = generateSyntheticData(seed)
  const storms = Math.max(...data.storm) + 1
  const testStorms = new Set<number>()
  const rng: Rng = mulberry32(seed + 7)
  while (testStorms.size < Math.floor(storms * 0.25)) {
    testStorms.add(Math.floor(rng() * storms))
  }

  const Xtr: number[][] = []
  const ytr: number[] = []
  const Xte: number[][] = []
  const yte: number[] = []
  for (let i = 0; i < data.y.length; i++) {
    if (testStorms.has(data.storm[i])) {
      Xte.push(data.X[i])
      yte.push(data.y[i])
    } else {
      Xtr.push(data.X[i])
      ytr.push(data.y[i])
    }
  }

  const model = new GradientBoostedModel(40, 3, 0.15, 6)
  model.train(Xtr, ytr)

  const preds = Xte.map((x) => model.predict(x))
  const n = yte.length
  const mae = preds.reduce((s, p, i) => s + Math.abs(p - yte[i]), 0) / n
  const mse = preds.reduce((s, p, i) => s + (p - yte[i]) ** 2, 0) / n
  const rmse = Math.sqrt(mse)
  const yMean = yte.reduce((s, v) => s + v, 0) / n
  const ssTot = yte.reduce((s, v) => s + (v - yMean) ** 2, 0)
  const ssRes = preds.reduce((s, p, i) => s + (p - yte[i]) ** 2, 0)
  const r2 = 1 - ssRes / ssTot

  return {
    model,
    metrics: {
      mae: Math.round(mae * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      r2: Math.round(r2 * 1000) / 1000,
      trainSamples: ytr.length,
      testSamples: yte.length,
      storms,
      trees: model.treeCount,
    },
  }
}
