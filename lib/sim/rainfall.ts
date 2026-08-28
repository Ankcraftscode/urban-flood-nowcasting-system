import { HORIZONS, type Horizon, type ScenarioId } from "./types"

export interface RainfallScenario {
  id: ScenarioId
  label: string
  description: string
  peak: number // mm/hr peak intensity
}

export const SCENARIOS: RainfallScenario[] = [
  { id: "light", label: "Light Rain", description: "Nuisance ponding only", peak: 18 },
  { id: "moderate", label: "Moderate Rain", description: "Localised waterlogging", peak: 42 },
  { id: "heavy", label: "Heavy Rain", description: "Widespread urban flooding", peak: 72 },
  { id: "extreme", label: "Extreme Rain", description: "Cloudburst / disaster scale", peak: 110 },
  { id: "custom", label: "Custom", description: "User-defined peak intensity", peak: 60 },
]

// Build a 0-3h rainfall nowcast time-series that rises to a peak then decays,
// mimicking the passage of a convective cell over the study area.
export function buildRainfallSeries(peak: number): { horizon: Horizon; rainfall: number }[] {
  // Relative shape across [now, +30, +60, +90, +120, +180]
  const shape = [0.55, 0.76, 1.0, 0.92, 0.68, 0.42]
  return HORIZONS.map((h, i) => ({
    horizon: h,
    rainfall: Math.round(peak * shape[i]),
  }))
}

export function scenarioById(id: ScenarioId): RainfallScenario {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[2]
}
