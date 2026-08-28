import type { City, GridCell, RoadEdge, RoadNode } from "./types"

export interface RoadNetwork {
  nodes: RoadNode[]
  edges: RoadEdge[]
  // adjacency: nodeId -> array of { edgeId, to }
  adj: Map<number, { edgeId: number; to: number }[]>
}

// Build a routable road graph from the road cells of the terrain grid.
export function buildRoads(city: City, cells: GridCell[]): RoadNetwork {
  const N = city.gridN
  const nodes: RoadNode[] = []
  const nodeByCell = new Map<number, number>()

  for (const cell of cells) {
    if (!cell.isRoad) continue
    const nodeId = nodes.length
    nodes.push({ id: nodeId, lat: cell.lat, lng: cell.lng, gridCellId: cell.id })
    nodeByCell.set(cell.id, nodeId)
  }

  const edges: RoadEdge[] = []
  const adj = new Map<number, { edgeId: number; to: number }[]>()
  const cellSizeM = (city.spanLat * 111000) / N
  const seen = new Set<string>()

  function addEdge(aNode: number, bNode: number, name: string, importance: number) {
    const key = aNode < bNode ? `${aNode}-${bNode}` : `${bNode}-${aNode}`
    if (seen.has(key)) return
    seen.add(key)
    const edgeId = edges.length
    edges.push({ id: edgeId, from: aNode, to: bNode, name, length: Math.round(cellSizeM), importance })
    if (!adj.has(aNode)) adj.set(aNode, [])
    if (!adj.has(bNode)) adj.set(bNode, [])
    adj.get(aNode)!.push({ edgeId, to: bNode })
    adj.get(bNode)!.push({ edgeId, to: aNode })
  }

  for (const cell of cells) {
    if (!cell.isRoad) continue
    const aNode = nodeByCell.get(cell.id)!
    const neighbours = [
      { r: cell.row, c: cell.col + 1 },
      { r: cell.row + 1, c: cell.col },
    ]
    for (const nb of neighbours) {
      if (nb.r >= N || nb.c >= N) continue
      const nCell = cells[nb.r * N + nb.c]
      if (!nCell.isRoad) continue
      const bNode = nodeByCell.get(nCell.id)
      if (bNode === undefined) continue
      const name = cell.roadName ?? nCell.roadName ?? "Road"
      const importance = cell.row % 5 === 2 || cell.col % 6 === 3 ? 3 : 2
      addEdge(aNode, bNode, name, importance)
    }
  }

  return { nodes, edges, adj }
}

export function nearestRoadNode(network: RoadNetwork, lat: number, lng: number): number {
  let best = Infinity
  let bestId = network.nodes[0]?.id ?? -1
  for (const n of network.nodes) {
    const d = Math.hypot(n.lat - lat, n.lng - lng)
    if (d < best) {
      best = d
      bestId = n.id
    }
  }
  return bestId
}
