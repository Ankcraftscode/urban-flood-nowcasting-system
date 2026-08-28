import type { City, DrainNode, DrainPipe, GridCell } from "./types"
import { hashString, mulberry32, randRange, type Rng } from "./rng"

// Manning's equation for a circular pipe flowing full:
//   Q = (1/n) * A * R^(2/3) * S^(1/2)
//   A = pi d^2 / 4 ,  R = d / 4
export function manningCapacity(diameter: number, slope: number, roughness: number): number {
  const A = (Math.PI * diameter * diameter) / 4
  const R = diameter / 4
  return (1 / roughness) * A * Math.pow(R, 2 / 3) * Math.sqrt(slope)
}

export interface DrainNetwork {
  nodes: DrainNode[]
  pipes: DrainPipe[]
}

// Place drain nodes on a coarse lattice, then connect each node to the
// downhill neighbouring node to form a directed graph ending in outfalls.
export function buildDrainage(city: City, cells: GridCell[]): DrainNetwork {
  const rng = mulberry32(hashString(city.id + "-drain"))
  const N = city.gridN
  const step = 4 // node spacing in grid cells
  const nodes: DrainNode[] = []
  const nodeGrid: number[][] = []

  let idx = 0
  for (let r = 2; r < N; r += step) {
    for (let c = 2; c < N; c += step) {
      const cell = cells[r * N + c]
      const isEdge = r + step >= N || c + step >= N
      const kind = pickKind(rng, isEdge, idx)
      nodes.push({
        id: idx,
        kind,
        lat: cell.lat,
        lng: cell.lng,
        capacity: 0,
        blockage: rng() < 0.18 ? Math.round(randRange(rng, 0.25, 0.6) * 100) / 100 : 0,
      })
      nodeGrid.push([r, c])
      idx++
    }
  }

  const pipes: DrainPipe[] = []
  const cellSizeM = (city.spanLat * 111000) / N
  let pipeId = 0

  for (let i = 0; i < nodes.length; i++) {
    const [r, c] = nodeGrid[i]
    const fromCell = cells[r * N + c]
    // find neighbouring node (within step) with lowest elevation to route to
    let bestJ = -1
    let bestElev = fromCell.elevation
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue
      const [nr, nc] = nodeGrid[j]
      if (Math.abs(nr - r) + Math.abs(nc - c) !== step) continue
      const nCell = cells[nr * N + nc]
      if (nCell.elevation < bestElev) {
        bestElev = nCell.elevation
        bestJ = j
      }
    }
    if (bestJ >= 0) {
      const toCell = cells[nodeGrid[bestJ][0] * N + nodeGrid[bestJ][1]]
      const length = step * cellSizeM
      const slope = Math.max(0.001, (fromCell.elevation - toCell.elevation) / length)
      const diameter = Math.round(randRange(rng, 0.6, 1.4) * 100) / 100
      const roughness = 0.013
      const capacity = manningCapacity(diameter, slope, roughness)
      pipes.push({
        id: pipeId++,
        from: i,
        to: bestJ,
        diameter,
        length: Math.round(length),
        slope: Math.round(slope * 10000) / 10000,
        roughness,
        capacity: Math.round(capacity * 100) / 100,
      })
    } else {
      nodes[i].kind = "outfall"
    }
  }

  // Node design capacity = sum of outgoing pipe capacity (or generous if outfall).
  for (const node of nodes) {
    const out = pipes.filter((p) => p.from === node.id)
    let cap = out.reduce((s, p) => s + p.capacity, 0)
    if (node.kind === "outfall") cap = Math.max(cap, randRange(rng, 6, 10))
    if (cap <= 0) cap = randRange(rng, 1.5, 3)
    node.capacity = Math.round(cap * 100) / 100
  }

  assignNearestDrains(cells, nodes, city)
  return { nodes, pipes }
}

function pickKind(rng: Rng, isEdge: boolean, idx: number): DrainNode["kind"] {
  if (isEdge && rng() < 0.5) return "outfall"
  const v = rng()
  if (v < 0.4) return "inlet"
  if (v < 0.8) return "manhole"
  return "junction"
}

function assignNearestDrains(cells: GridCell[], nodes: DrainNode[], city: City) {
  const N = city.gridN
  const mPerDegLat = 111000
  const mPerDegLng = 111000 * Math.cos((city.center[0] * Math.PI) / 180)
  for (const cell of cells) {
    let best = Infinity
    let bestId = -1
    for (const node of nodes) {
      const dLat = (cell.lat - node.lat) * mPerDegLat
      const dLng = (cell.lng - node.lng) * mPerDegLng
      const d = Math.hypot(dLat, dLng)
      if (d < best) {
        best = d
        bestId = node.id
      }
    }
    cell.nearestDrainId = bestId
    cell.nearestDrainDist = Math.round(best)
  }
}

export function effectiveCapacity(node: DrainNode): number {
  return node.capacity * (1 - node.blockage)
}

export function drainStatus(util: number): "normal" | "near" | "overloaded" | "severe" {
  if (util < 80) return "normal"
  if (util < 100) return "near"
  if (util < 120) return "overloaded"
  return "severe"
}
