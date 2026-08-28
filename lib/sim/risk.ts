import type { RiskLevel } from "./types"

// Prototype risk thresholds (cm). NOT official municipal safety standards.
export function classifyRisk(depthCm: number): RiskLevel {
  if (depthCm < 5) return "safe"
  if (depthCm < 15) return "low"
  if (depthCm < 30) return "moderate"
  if (depthCm < 50) return "high"
  return "severe"
}

export const RISK_META: Record<RiskLevel, { label: string; range: string; color: string; order: number }> = {
  safe: { label: "Safe", range: "0–5 cm", color: "#2f9e6f", order: 0 },
  low: { label: "Low", range: "5–15 cm", color: "#7bc043", order: 1 },
  moderate: { label: "Moderate", range: "15–30 cm", color: "#f4b400", order: 2 },
  high: { label: "High", range: "30–50 cm", color: "#f56a1c", order: 3 },
  severe: { label: "Severe", range: ">50 cm", color: "#d7263d", order: 4 },
}

export function riskColor(level: RiskLevel): string {
  return RISK_META[level].color
}

// Depth-based colour ramp for smooth flood overlay.
export function depthColor(depthCm: number): string {
  return riskColor(classifyRisk(depthCm))
}
