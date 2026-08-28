import {
  HORIZONS,
  type CityId,
  type DrainState,
  type FloodAlert,
  type Horizon,
  type HorizonResult,
  type Hotspot,
  type NowcastResult,
  type ScenarioId,
} from "./types"
import { CITIES } from "./cities"
import { buildGrid } from "./terrain"
import { buildDrainage, drainStatus, effectiveCapacity } from "./drainage"
import { buildRoads } from "./roads"
import { buildRainfallSeries, scenarioById } from "./rainfall"
import { classifyRisk } from "./risk"
import { hashString } from "./rng"
import { GradientBoostedModel, trainFloodModel } from "./model"

// Interval (minutes) of rainfall represented at each horizon step.
const STEP_MINUTES: number[] = [15, 30, 30, 30, 30, 60]

const DRAIN_SUPPLY_PER_MIN = 0.68 // cm of aggregate removal per (m^3/s * minute)
const DRAIN_CELL_MAX = 55 // cm removable from a single cell per step
const ROUTE_RETAIN = 0.63 // fraction of water a cell retains when routing downhill
const MAX_POND = 80 // cm max surface ponding a cell can hold before it spreads laterally

export interface EngineInput {
  cityId: CityId
  scenario: ScenarioId
  customPeak?: number
  extraBlockage?: number // 0-1 additional blockage applied to all drains
}

// Cached trained model per-city (physics is city independent, so seed by "flood").
const modelCache = new Map<string, { model: GradientBoostedModel; metrics: NowcastResult["metrics"] }>()

function getModel() {
  const key = "global"
  if (!modelCache.has(key)) {
    modelCache.set(key, trainFloodModel(hashString("urban-flood-nowcast")))
  }
  return modelCache.get(key)!
}

export function runNowcast(input: EngineInput): NowcastResult {
  const city = CITIES[input.cityId]
  const cells = buildGrid(city)
  const { nodes: drains, pipes } = buildDrainage(city, cells)
  const roads = buildRoads(city, cells)

  if (input.extraBlockage && input.extraBlockage > 0) {
    for (const d of drains) d.blockage = Math.min(0.9, d.blockage + input.extraBlockage)
  }

  const scen = scenarioById(input.scenario)
  const peak = input.scenario === "custom" ? (input.customPeak ?? scen.peak) : scen.peak
  const rainfallSeries = buildRainfallSeries(peak)

  // Normalisation helpers.
  const elevs = cells.map((c) => c.elevation)
  const minE = Math.min(...elevs)
  const maxE = Math.max(...elevs)
  const maxAccum = Math.max(...cells.map((c) => c.flowAccum))
  const elevNorm = (e: number) => (maxE > minE ? (e - minE) / (maxE - minE) : 0.5)

  // Cells ordered high -> low for cascading surface routing.
  const routeOrder = [...cells].sort((a, b) => b.elevation - a.elevation)

  const depth = new Array(cells.length).fill(0) // cm, persists across horizons
  const cellMax = new Array(cells.length).fill(0)
  const cellPeakHorizon = new Array(cells.length).fill(0)
  const cellDurations = new Array(cells.length).fill(0)
  const cellPeakUtil = new Array(cells.length).fill(0)

  const { model, metrics } = getModel()
  const horizons: HorizonResult[] = []

  HORIZONS.forEach((h, step) => {
    const rainfall = rainfallSeries[step].rainfall
    const interval = STEP_MINUTES[step]

    // 1. RAINFALL -> RUNOFF: add source water to each cell.
    for (const c of cells) {
      const runoffMm = rainfall * (interval / 60) * c.runoffCoeff
      depth[c.id] += runoffMm / 10 // mm -> cm
    }

    // 2. 2D SURFACE FLOW: cascade water downhill (high -> low).
    for (const c of routeOrder) {
      if (c.flowDir < 0) continue
      const movable = depth[c.id] * (1 - ROUTE_RETAIN)
      if (movable <= 0.01) continue
      depth[c.id] -= movable
      depth[c.flowDir] += movable
    }

    // 3. DRAINAGE removal + surcharge per drain node.
    const drainStates: DrainState[] = drains.map((d) => ({ inflow: 0, utilization: 0, status: "normal" }))
    const assigned: number[][] = drains.map(() => [])
    for (const c of cells) assigned[c.nearestDrainId]?.push(c.id)

    drains.forEach((d, di) => {
      const cellIds = assigned[di]
      let demand = 0
      for (const id of cellIds) demand += Math.min(depth[id], DRAIN_CELL_MAX)
      const supply = effectiveCapacity(d) * DRAIN_SUPPLY_PER_MIN * interval
      // Cap reported utilization at 400% — beyond that the drain is simply
      // "fully overwhelmed" and larger ratios add no useful signal.
      const util = Math.min(400, supply > 0 ? (demand / supply) * 100 : 400)
      const ratio = demand > 0 ? Math.min(1, supply / demand) : 0
      for (const id of cellIds) {
        const removable = Math.min(depth[id], DRAIN_CELL_MAX) * ratio
        depth[id] -= removable
      }
      const inflowM3s = Math.min(demand, supply) / (DRAIN_SUPPLY_PER_MIN * interval)
      drainStates[di] = {
        inflow: Math.round(inflowM3s * 100) / 100,
        utilization: Math.round(util),
        status: drainStatus(util),
      }
    })

    // Lateral spreading: water beyond max ponding overflows to lower neighbours.
    for (const c of routeOrder) {
      if (depth[c.id] <= MAX_POND) continue
      const excess = depth[c.id] - MAX_POND
      depth[c.id] = MAX_POND
      if (c.flowDir >= 0) depth[c.flowDir] += excess
    }

    // 4. Record per-cell state + risk for this horizon.
    const cellDepths = depth.map((v) => Math.round(v * 10) / 10)
    const cellRisk = cellDepths.map((v) => classifyRisk(v))

    let floodedRoadCount = 0
    let maxDepth = 0
    for (const c of cells) {
      const dpt = cellDepths[c.id]
      if (dpt > maxDepth) maxDepth = dpt
      if (c.isRoad && dpt >= 15) floodedRoadCount++
      if (dpt > cellMax[c.id]) {
        cellMax[c.id] = dpt
        cellPeakHorizon[c.id] = h
      }
      if (dpt >= 15) cellDurations[c.id] += 1
      const util = drainStates[c.nearestDrainId]?.utilization ?? 0
      if (util > cellPeakUtil[c.id]) cellPeakUtil[c.id] = util
    }

    const peopleAtRisk = Math.round(floodedRoadCount * 180 + (maxDepth > 30 ? 400 : 0))

    horizons.push({
      horizon: h,
      rainfall,
      cellDepths,
      cellRisk,
      drainStates,
      floodedRoadCount,
      maxDepth: Math.round(maxDepth),
      peopleAtRisk,
    })
  })

  const hotspots = computeHotspots(cells, cellMax, cellPeakHorizon, cellDurations, cellPeakUtil, maxAccum)
  const alerts = computeAlerts(hotspots, horizons)

  return {
    city,
    cells,
    drains,
    pipes,
    roadNodes: roads.nodes,
    roadEdges: roads.edges,
    horizons,
    hotspots,
    alerts,
    metrics,
    rainfallSeries,
    peakRainfall: peak,
  }
}

function computeHotspots(
  cells: NowcastResult["cells"],
  cellMax: number[],
  cellPeakHorizon: number[],
  cellDurations: number[],
  cellPeakUtil: number[],
  maxAccum: number,
): Hotspot[] {
  const scored = cells
    .filter((c) => cellMax[c.id] >= 10)
    .map((c) => {
      const importance = c.isRoad ? (c.row % 5 === 2 || c.col % 6 === 3 ? 3 : 2) : 1
      const flowAccumNorm = c.flowAccum / maxAccum
      // Depth dominates so the worst-flooded locations always surface as the
      // top hotspots; duration, drainage stress, flow and road importance
      // break ties between similarly-deep cells.
      const score =
        cellMax[c.id] * 1.6 +
        cellDurations[c.id] * 3 +
        cellPeakUtil[c.id] * 0.05 +
        flowAccumNorm * 6 +
        importance * 3
      return { c, score }
    })
    .sort((a, b) => b.score - a.score)

  // De-duplicate spatially so hotspots aren't all in one basin.
  const chosen: typeof scored = []
  for (const s of scored) {
    if (chosen.some((o) => Math.abs(o.c.row - s.c.row) <= 1 && Math.abs(o.c.col - s.c.col) <= 1)) continue
    chosen.push(s)
    if (chosen.length >= 6) break
  }

  return chosen.map((s, i) => {
    const c = s.c
    const name = c.roadName
      ? `${c.roadName} ${c.row % 5 === 2 && c.col % 6 === 3 ? "Junction" : "Stretch"}`
      : c.isRoad
        ? `Intersection ${String.fromCharCode(65 + i)}`
        : `Zone ${String.fromCharCode(65 + i)}`
    return {
      id: `hs-${c.id}`,
      name,
      lat: c.lat,
      lng: c.lng,
      cellId: c.id,
      maxDepth: Math.round(cellMax[c.id]),
      peakHorizon: cellPeakHorizon[c.id] as Horizon,
      score: Math.round(s.score),
      drainUtilization: Math.round(cellPeakUtil[c.id]),
    }
  })
}

function computeAlerts(hotspots: Hotspot[], horizons: HorizonResult[]): FloodAlert[] {
  return hotspots
    .filter((h) => h.maxDepth >= 30)
    .slice(0, 5)
    .map((h) => {
      // Time to first horizon where this cell crosses 30 cm.
      let minutes = h.peakHorizon
      for (const hr of horizons) {
        if (hr.cellDepths[h.cellId] >= 30) {
          minutes = hr.horizon
          break
        }
      }
      const risk = classifyRisk(h.maxDepth)
      return {
        id: `alert-${h.cellId}`,
        location: h.name,
        lat: h.lat,
        lng: h.lng,
        expectedDepth: h.maxDepth,
        minutesToCritical: minutes === 0 ? 5 : minutes,
        drainUtilization: h.drainUtilization,
        risk,
        action: risk === "severe" ? "Close and divert all traffic." : "Avoid this intersection.",
      }
    })
}

export { HORIZONS }
