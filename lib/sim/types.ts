// Core type definitions for the Urban Flood Nowcasting simulation engine.
// NOTE: All data produced by this engine is PROTOTYPE / SIMULATED data.

export type CityId = "delhi" | "mumbai" | "chennai"

export type ScenarioId = "light" | "moderate" | "heavy" | "extreme" | "custom"

export type LandUse = "concrete" | "asphalt" | "building" | "grass" | "soil"

export type RiskLevel = "safe" | "low" | "moderate" | "high" | "severe"

export type VehicleType = "ambulance" | "fire" | "police" | "transit" | "normal"

// The six nowcast horizons in minutes from "now".
export const HORIZONS = [0, 30, 60, 90, 120, 180] as const
export type Horizon = (typeof HORIZONS)[number]

export interface City {
  id: CityId
  name: string
  region: string
  center: [number, number] // [lat, lng]
  spanLat: number
  spanLng: number
  gridN: number // grid is gridN x gridN cells
  baseElevation: number // meters
}

export interface GridCell {
  id: number
  row: number
  col: number
  lat: number
  lng: number
  elevation: number // meters
  slope: number // percent
  flowDir: number // index of downstream neighbor cell id, -1 = sink
  flowAccum: number // number of upstream contributing cells
  imperviousness: number // percent 0-100
  landUse: LandUse
  runoffCoeff: number
  nearestDrainId: number
  nearestDrainDist: number // meters
  isRoad: boolean
  roadName?: string
}

export interface DrainNode {
  id: number
  kind: "manhole" | "inlet" | "junction" | "outfall"
  lat: number
  lng: number
  capacity: number // m^3/s design capacity
  blockage: number // 0-1 fraction blocked
}

export interface DrainPipe {
  id: number
  from: number
  to: number
  diameter: number // m
  length: number // m
  slope: number // m/m
  roughness: number // Manning n
  capacity: number // m^3/s (Manning)
}

export interface RoadNode {
  id: number
  lat: number
  lng: number
  gridCellId: number
}

export interface RoadEdge {
  id: number
  from: number
  to: number
  name: string
  length: number // meters
  importance: number // 1 (minor) - 3 (arterial)
}

// Per-horizon dynamic state of a grid cell.
export interface CellState {
  depth: number // cm
  risk: RiskLevel
}

// Per-horizon dynamic state of a drain node.
export interface DrainState {
  inflow: number // m^3/s
  utilization: number // percent
  status: "normal" | "near" | "overloaded" | "severe"
}

export interface HorizonResult {
  horizon: Horizon
  rainfall: number // mm/hr
  cellDepths: number[] // indexed by grid cell id, cm
  cellRisk: RiskLevel[]
  drainStates: DrainState[] // indexed by drain node id
  floodedRoadCount: number
  maxDepth: number
  peopleAtRisk: number
}

export interface Hotspot {
  id: string
  name: string
  lat: number
  lng: number
  cellId: number
  maxDepth: number
  peakHorizon: Horizon
  score: number
  drainUtilization: number
}

export interface FloodAlert {
  id: string
  location: string
  lat: number
  lng: number
  expectedDepth: number
  minutesToCritical: number
  drainUtilization: number
  risk: RiskLevel
  action: string
}

export interface ModelMetrics {
  mae: number
  rmse: number
  r2: number
  trainSamples: number
  testSamples: number
  storms: number
  trees: number
}

export interface RouteResult {
  found: boolean
  coords: [number, number][]
  distanceKm: number
  maxDepth: number
  exposure: RiskLevel
  avoidedSegments: number
}

export interface NowcastResult {
  city: City
  cells: GridCell[]
  drains: DrainNode[]
  pipes: DrainPipe[]
  roadNodes: RoadNode[]
  roadEdges: RoadEdge[]
  horizons: HorizonResult[]
  hotspots: Hotspot[]
  alerts: FloodAlert[]
  metrics: ModelMetrics
  rainfallSeries: { horizon: Horizon; rainfall: number }[]
  peakRainfall: number
}
