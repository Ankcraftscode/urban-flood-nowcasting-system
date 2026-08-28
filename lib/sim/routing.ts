import type { RouteResult, VehicleType } from "./types"
import { classifyRisk } from "./risk"
import type { RoadNetwork } from "./roads"

// Maximum passable flood depth (cm) per vehicle type. Beyond this the edge is
// effectively impassable and is heavily penalised (emergency vehicles stricter).
const MAX_DEPTH: Record<VehicleType, number> = {
  ambulance: 20,
  fire: 30,
  police: 25,
  transit: 22,
  normal: 15,
}

const VEHICLE_LABEL: Record<VehicleType, string> = {
  ambulance: "Ambulance",
  fire: "Fire Truck",
  police: "Police",
  transit: "Public Transport",
  normal: "Normal Vehicle",
}

export function vehicleLabel(v: VehicleType): string {
  return VEHICLE_LABEL[v]
}

// Cost of traversing an edge given its flood depth and vehicle tolerance.
function edgeCost(lengthM: number, depthCm: number, vehicle: VehicleType): number {
  const limit = MAX_DEPTH[vehicle]
  let penalty = 1
  if (depthCm >= 5) penalty += (depthCm / 5) ** 1.6
  if (depthCm > limit) penalty += 500 // effectively avoid
  return lengthM * penalty
}

export interface RoadDepthLookup {
  // depth (cm) at a given road node's grid cell
  (nodeId: number): number
}

// Dijkstra shortest path minimising flood-weighted cost.
function dijkstra(
  network: RoadNetwork,
  start: number,
  goal: number,
  depthAtNode: RoadDepthLookup,
  vehicle: VehicleType,
): number[] | null {
  const dist = new Map<number, number>()
  const prev = new Map<number, number>()
  const visited = new Set<number>()
  dist.set(start, 0)
  const pq: { node: number; d: number }[] = [{ node: start, d: 0 }]

  while (pq.length) {
    pq.sort((a, b) => a.d - b.d)
    const { node } = pq.shift()!
    if (visited.has(node)) continue
    visited.add(node)
    if (node === goal) break
    const neighbours = network.adj.get(node) ?? []
    for (const { edgeId, to } of neighbours) {
      if (visited.has(to)) continue
      const edge = network.edges[edgeId]
      const depth = Math.max(depthAtNode(node), depthAtNode(to))
      const cost = edgeCost(edge.length, depth, vehicle)
      const nd = (dist.get(node) ?? Infinity) + cost
      if (nd < (dist.get(to) ?? Infinity)) {
        dist.set(to, nd)
        prev.set(to, node)
        pq.push({ node: to, d: nd })
      }
    }
  }

  if (!prev.has(goal) && start !== goal) return null
  const path: number[] = []
  let cur: number | undefined = goal
  while (cur !== undefined) {
    path.unshift(cur)
    if (cur === start) break
    cur = prev.get(cur)
  }
  return path[0] === start ? path : null
}

export function computeRoute(
  network: RoadNetwork,
  start: number,
  goal: number,
  depthAtNode: RoadDepthLookup,
  vehicle: VehicleType,
  floodAware: boolean,
): RouteResult {
  const lookup: RoadDepthLookup = floodAware ? depthAtNode : () => 0
  const path = dijkstra(network, start, goal, lookup, vehicle)
  if (!path) {
    return { found: false, coords: [], distanceKm: 0, maxDepth: 0, exposure: "safe", avoidedSegments: 0 }
  }
  const coords: [number, number][] = path.map((id) => {
    const n = network.nodes[id]
    return [n.lat, n.lng]
  })
  let distanceKm = 0
  let maxDepth = 0
  let avoided = 0
  for (let i = 0; i < path.length - 1; i++) {
    const a = network.nodes[path[i]]
    const b = network.nodes[path[i + 1]]
    distanceKm += Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 100) 
    const d = Math.max(depthAtNode(path[i]), depthAtNode(path[i + 1]))
    maxDepth = Math.max(maxDepth, d)
    if (d >= 15) avoided++
  }
  return {
    found: true,
    coords,
    distanceKm: Math.round(distanceKm * 10) / 10,
    maxDepth: Math.round(maxDepth),
    exposure: classifyRisk(maxDepth),
    avoidedSegments: avoided,
  }
}

export { MAX_DEPTH }
