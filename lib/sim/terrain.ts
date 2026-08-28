import type { City, GridCell, LandUse } from "./types"
import { hashString, mulberry32, type Rng } from "./rng"

const RUNOFF_COEFF: Record<LandUse, number> = {
  concrete: 0.9,
  asphalt: 0.85,
  building: 0.95,
  grass: 0.3,
  soil: 0.2,
}

const IMPERVIOUSNESS: Record<LandUse, [number, number]> = {
  concrete: [85, 96],
  asphalt: [80, 92],
  building: [88, 98],
  grass: [15, 35],
  soil: [8, 25],
}

// Smooth value-noise from a few sinusoids seeded per-city.
function terrainNoise(x: number, y: number, seed: number): number {
  const s = (seed % 1000) / 1000
  return (
    Math.sin((x * 3.1 + s * 6.28) ) * 0.5 +
    Math.sin((y * 2.7 + s * 3.14)) * 0.4 +
    Math.sin((x * 6.2 + y * 5.1)) * 0.25 +
    Math.cos((x * 1.7 - y * 2.2 + s)) * 0.35
  )
}

interface Basin {
  cx: number
  cy: number
  depth: number
  radius: number
}

export function buildGrid(city: City): GridCell[] {
  const seed = hashString(city.id)
  const rng = mulberry32(seed)
  const N = city.gridN
  const cells: GridCell[] = []

  // Low-lying basins snapped onto road-corridor intersections so that streets
  // (not just open ground) sit in the flood-prone zones — key for road routing.
  const roadRows = [2, 7, 12, 17].filter((r) => r < N)
  const roadCols = [3, 9, 15, 21].filter((c) => c < N)
  const corridorPoint = () => {
    const r = roadRows[Math.floor(rng() * roadRows.length)]
    const c = roadCols[Math.floor(rng() * roadCols.length)]
    return { cx: c / (N - 1), cy: r / (N - 1) }
  }
  const p1 = corridorPoint()
  const p2 = corridorPoint()
  const basins: Basin[] = [
    { cx: p1.cx, cy: p1.cy, depth: 5.8, radius: 0.24 },
    { cx: p2.cx, cy: p2.cy, depth: 4.2, radius: 0.18 },
    { cx: randUnit(rng), cy: randUnit(rng), depth: 3.4, radius: 0.15 },
  ]

  const elevs: number[] = []
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x = c / (N - 1)
      const y = r / (N - 1)
      // General regional tilt so there is an overall drainage direction.
      let e = city.baseElevation + (1 - y) * 6 + x * 3
      e += terrainNoise(x, y, seed) * 2.2
      // Carve basins.
      for (const b of basins) {
        const d = Math.hypot(x - b.cx, y - b.cy)
        e -= b.depth * Math.exp(-(d * d) / (2 * b.radius * b.radius))
      }
      elevs.push(e)
    }
  }

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const id = r * N + c
      const lat = city.center[0] + city.spanLat * (0.5 - r / (N - 1))
      const lng = city.center[1] + city.spanLng * (c / (N - 1) - 0.5)
      const elevation = elevs[id]

      const { landUse, isRoad, roadName } = classifyCell(rng, r, c, N)
      const [iMin, iMax] = IMPERVIOUSNESS[landUse]
      const imperviousness = Math.round(iMin + rng() * (iMax - iMin))

      cells.push({
        id,
        row: r,
        col: c,
        lat,
        lng,
        elevation: Math.round(elevation * 10) / 10,
        slope: 0,
        flowDir: -1,
        flowAccum: 0,
        imperviousness,
        landUse,
        runoffCoeff: RUNOFF_COEFF[landUse],
        nearestDrainId: -1,
        nearestDrainDist: 0,
        isRoad,
        roadName,
      })
    }
  }

  computeSlopeAndFlow(cells, N, city)
  computeFlowAccumulation(cells, N)
  return cells
}

function randUnit(rng: Rng): number {
  return 0.2 + rng() * 0.6
}

const ROAD_NAMES = [
  "MG Marg",
  "Ring Road",
  "Station Rd",
  "Canal Ave",
  "Nehru St",
  "Market Rd",
  "Gandhi Path",
  "Link Rd",
]

function classifyCell(
  rng: Rng,
  r: number,
  c: number,
  N: number,
): { landUse: LandUse; isRoad: boolean; roadName?: string } {
  // Road grid: every ~5th row/col is an arterial road corridor.
  const rowRoad = r % 5 === 2
  const colRoad = c % 6 === 3
  if (rowRoad || colRoad) {
    const nameIdx = (rowRoad ? Math.floor(r / 5) : Math.floor(c / 6) + 4) % ROAD_NAMES.length
    return { landUse: "asphalt", isRoad: true, roadName: ROAD_NAMES[nameIdx] }
  }
  const v = rng()
  let landUse: LandUse
  if (v < 0.42) landUse = "building"
  else if (v < 0.66) landUse = "concrete"
  else if (v < 0.82) landUse = "asphalt"
  else if (v < 0.93) landUse = "grass"
  else landUse = "soil"
  return { landUse, isRoad: false }
}

function computeSlopeAndFlow(cells: GridCell[], N: number, city: City) {
  const cellSizeM = (city.spanLat * 111000) / N // approx meters per cell
  for (const cell of cells) {
    const { row: r, col: c } = cell
    let minElev = cell.elevation
    let minId = -1
    let maxDrop = 0
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue
        const n = cells[nr * N + nc]
        const dist = Math.hypot(dr, dc) * cellSizeM
        const drop = (cell.elevation - n.elevation) / dist
        if (n.elevation < minElev) {
          minElev = n.elevation
          minId = n.id
        }
        if (drop > maxDrop) maxDrop = drop
      }
    }
    cell.flowDir = minId
    cell.slope = Math.round(Math.max(0.05, maxDrop * 100) * 100) / 100
  }
}

function computeFlowAccumulation(cells: GridCell[], N: number) {
  // Process cells from highest to lowest so upstream contributions arrive first.
  const order = [...cells].sort((a, b) => b.elevation - a.elevation)
  const accum = new Array(cells.length).fill(1)
  for (const cell of order) {
    if (cell.flowDir >= 0) {
      accum[cell.flowDir] += accum[cell.id]
    }
  }
  for (const cell of cells) cell.flowAccum = accum[cell.id]
}

export function flowAccumClass(v: number, maxAccum: number): "Low" | "Medium" | "High" {
  const f = v / maxAccum
  if (f > 0.25) return "High"
  if (f > 0.08) return "Medium"
  return "Low"
}
