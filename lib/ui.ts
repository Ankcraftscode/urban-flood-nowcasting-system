import type { RiskLevel } from "@/lib/sim/types"

// Maps a flood risk level to theme tokens and human-readable copy.
// Colors reference the flood-risk ramp defined in globals.css.
export const RISK_META: Record<
  RiskLevel,
  { label: string; token: string; hex: string; text: string; badge: string }
> = {
  safe: {
    label: "Safe",
    token: "var(--risk-safe)",
    hex: "#2dd4bf",
    text: "text-[var(--risk-safe)]",
    badge: "bg-[var(--risk-safe)]/15 text-[var(--risk-safe)] border-[var(--risk-safe)]/30",
  },
  low: {
    label: "Low",
    token: "var(--risk-low)",
    hex: "#38bdf8",
    text: "text-[var(--risk-low)]",
    badge: "bg-[var(--risk-low)]/15 text-[var(--risk-low)] border-[var(--risk-low)]/30",
  },
  moderate: {
    label: "Moderate",
    token: "var(--risk-moderate)",
    hex: "#facc15",
    text: "text-[var(--risk-moderate)]",
    badge: "bg-[var(--risk-moderate)]/15 text-[var(--risk-moderate)] border-[var(--risk-moderate)]/30",
  },
  high: {
    label: "High",
    token: "var(--risk-high)",
    hex: "#fb923c",
    text: "text-[var(--risk-high)]",
    badge: "bg-[var(--risk-high)]/15 text-[var(--risk-high)] border-[var(--risk-high)]/30",
  },
  severe: {
    label: "Severe",
    token: "var(--risk-severe)",
    hex: "#ef4444",
    text: "text-[var(--risk-severe)]",
    badge: "bg-[var(--risk-severe)]/15 text-[var(--risk-severe)] border-[var(--risk-severe)]/30",
  },
}

// Continuous color ramp for a flood depth in cm (used for map cell shading).
export function depthColor(depthCm: number): string {
  if (depthCm < 5) return "transparent"
  if (depthCm < 15) return "#38bdf8" // low
  if (depthCm < 30) return "#facc15" // moderate
  if (depthCm < 50) return "#fb923c" // high
  return "#ef4444" // severe
}

export function depthOpacity(depthCm: number): number {
  if (depthCm < 5) return 0
  return Math.min(0.72, 0.22 + (depthCm / 80) * 0.6)
}

export function formatHorizon(minutes: number): string {
  if (minutes === 0) return "Now"
  return `+${minutes}m`
}
