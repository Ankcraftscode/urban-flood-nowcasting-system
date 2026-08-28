"use server"

import { runNowcast } from "@/lib/sim/engine"
import type { CityId, NowcastResult, ScenarioId } from "@/lib/sim/types"

export interface RunNowcastParams {
  cityId: CityId
  scenario: ScenarioId
  customPeak?: number
  extraBlockage?: number
}

export interface NowcastResponse {
  result: NowcastResult
  computeMs: number
  generatedAt: string
}

// Runs the full coupled pipeline (terrain -> rainfall -> runoff -> surface flow
// -> drainage hydraulics -> ML flood-depth surrogate -> risk -> hotspots -> alerts)
// on the server. The ML model is trained once and cached across requests.
export async function runNowcastAction(params: RunNowcastParams): Promise<NowcastResponse> {
  const t0 = Date.now()
  const result = runNowcast({
    cityId: params.cityId,
    scenario: params.scenario,
    customPeak: params.customPeak,
    extraBlockage: params.extraBlockage,
  })
  return {
    result,
    computeMs: Date.now() - t0,
    generatedAt: new Date().toISOString(),
  }
}
