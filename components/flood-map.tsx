"use client"

import { useEffect, useMemo } from "react"
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet"
import type { LatLngBoundsExpression } from "leaflet"
import "leaflet/dist/leaflet.css"
import type { NowcastResult, RouteResult, Hotspot } from "@/lib/sim/types"
import { depthColor, depthOpacity, RISK_META } from "@/lib/ui"
import { classifyRisk } from "@/lib/sim/risk"

export interface MapLayers {
  flood: boolean
  drains: boolean
  roads: boolean
  hotspots: boolean
}

interface FloodMapProps {
  result: NowcastResult
  horizonIndex: number
  layers: MapLayers
  routeDirect?: RouteResult
  routeSafe?: RouteResult
  origin?: [number, number]
  destination?: [number, number]
  onMapClick?: (lat: number, lng: number) => void
  selectedHotspotId?: string
  onSelectHotspot?: (h: Hotspot) => void
}

const DRAIN_STATUS_COLOR: Record<string, string> = {
  normal: "#2dd4bf",
  near: "#facc15",
  overloaded: "#fb923c",
  severe: "#ef4444",
}

function ClickHandler({ onMapClick }: { onMapClick?: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onMapClick?.(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function Recenter({ center, cityId }: { center: [number, number]; cityId: string }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityId])
  return null
}

export default function FloodMap({
  result,
  horizonIndex,
  layers,
  routeDirect,
  routeSafe,
  origin,
  destination,
  onMapClick,
  selectedHotspotId,
  onSelectHotspot,
}: FloodMapProps) {
  const { city, cells, drains, roadNodes, roadEdges, hotspots } = result
  const horizon = result.horizons[horizonIndex]

  const halfLat = city.spanLat / (city.gridN - 1) / 2
  const halfLng = city.spanLng / (city.gridN - 1) / 2

  const bounds = useMemo<LatLngBoundsExpression>(
    () => [
      [city.center[0] - city.spanLat / 2 - halfLat, city.center[1] - city.spanLng / 2 - halfLng],
      [city.center[0] + city.spanLat / 2 + halfLat, city.center[1] + city.spanLng / 2 + halfLng],
    ],
    [city, halfLat, halfLng],
  )

  const floodedCells = useMemo(() => {
    if (!layers.flood) return []
    return cells
      .map((c) => ({ c, depth: horizon.cellDepths[c.id] }))
      .filter((x) => x.depth >= 5)
  }, [cells, horizon, layers.flood])

  const nodeDepth = (nodeId: number) => {
    const n = roadNodes[nodeId]
    return n ? horizon.cellDepths[n.gridCellId] ?? 0 : 0
  }

  return (
    <MapContainer
      bounds={bounds}
      className="h-full w-full"
      zoomControl
      scrollWheelZoom
      attributionControl
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; OpenStreetMap &copy; CARTO — simulated flood data'
        maxZoom={20}
      />
      <Recenter center={city.center} cityId={city.id} />
      <ClickHandler onMapClick={onMapClick} />

      {/* Flood depth raster */}
      {floodedCells.map(({ c, depth }) => (
        <Rectangle
          key={`f-${c.id}`}
          bounds={[
            [c.lat - halfLat, c.lng - halfLng],
            [c.lat + halfLat, c.lng + halfLng],
          ]}
          pathOptions={{
            stroke: false,
            fillColor: depthColor(depth),
            fillOpacity: depthOpacity(depth),
          }}
        >
          <Tooltip sticky opacity={1}>
            <div className="font-mono text-xs">
              <div className="font-sans font-semibold">{c.roadName ?? c.landUse}</div>
              <div>Depth: {depth.toFixed(1)} cm</div>
              <div>Elev: {c.elevation} m · Imperv: {c.imperviousness}%</div>
              <div>Risk: {RISK_META[classifyRisk(depth)].label}</div>
            </div>
          </Tooltip>
        </Rectangle>
      ))}

      {/* Road network colored by flood status */}
      {layers.roads &&
        roadEdges.map((e) => {
          const d = Math.max(nodeDepth(e.from), nodeDepth(e.to))
          const flooded = d >= 15
          return (
            <Polyline
              key={`r-${e.id}`}
              positions={[
                [roadNodes[e.from].lat, roadNodes[e.from].lng],
                [roadNodes[e.to].lat, roadNodes[e.to].lng],
              ]}
              pathOptions={{
                color: flooded ? depthColor(d) : "#64748b",
                weight: flooded ? 3.5 : e.importance >= 3 ? 2.2 : 1.3,
                opacity: flooded ? 0.95 : 0.5,
              }}
            />
          )
        })}

      {/* Drainage nodes */}
      {layers.drains &&
        drains.map((d) => {
          const st = horizon.drainStates[d.id]
          return (
            <CircleMarker
              key={`d-${d.id}`}
              center={[d.lat, d.lng]}
              radius={st.status === "severe" ? 5 : st.status === "overloaded" ? 4 : 3}
              pathOptions={{
                color: DRAIN_STATUS_COLOR[st.status],
                fillColor: DRAIN_STATUS_COLOR[st.status],
                fillOpacity: 0.85,
                weight: 1,
              }}
            >
              <Tooltip>
                <div className="font-mono text-xs">
                  <div className="font-sans font-semibold capitalize">{d.kind}</div>
                  <div>Capacity: {d.capacity.toFixed(1)} m³/s</div>
                  <div>Blockage: {Math.round(d.blockage * 100)}%</div>
                  <div>Inflow: {st.inflow.toFixed(1)} m³/s</div>
                  <div>Utilization: {st.utilization}%</div>
                  <div className="capitalize">Status: {st.status}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}

      {/* Hotspots */}
      {layers.hotspots &&
        hotspots.map((h, i) => {
          const selected = h.id === selectedHotspotId
          const risk = classifyRisk(h.maxDepth)
          return (
            <CircleMarker
              key={h.id}
              center={[h.lat, h.lng]}
              radius={selected ? 12 : 9}
              eventHandlers={{ click: () => onSelectHotspot?.(h) }}
              pathOptions={{
                color: "#fff",
                weight: selected ? 2 : 1,
                fillColor: RISK_META[risk].hex,
                fillOpacity: 0.9,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} permanent={selected}>
                <div className="font-mono text-xs">
                  <div className="font-sans font-semibold">
                    #{i + 1} {h.name}
                  </div>
                  <div>Peak: {h.maxDepth} cm @ +{h.peakHorizon}m</div>
                  <div>Drain load: {h.drainUtilization}%</div>
                </div>
              </Tooltip>
            </CircleMarker>
          )
        })}

      {/* Routes */}
      {routeDirect?.found && (
        <Polyline
          positions={routeDirect.coords}
          pathOptions={{ color: "#ef4444", weight: 5, opacity: 0.85, dashArray: "1 8" }}
        />
      )}
      {routeSafe?.found && (
        <Polyline
          positions={routeSafe.coords}
          pathOptions={{ color: "#2dd4bf", weight: 5, opacity: 0.95 }}
        />
      )}

      {origin && (
        <CircleMarker
          center={origin}
          radius={7}
          pathOptions={{ color: "#fff", weight: 2, fillColor: "#38bdf8", fillOpacity: 1 }}
        >
          <Tooltip permanent direction="right">
            <span className="font-sans text-xs font-semibold">Origin</span>
          </Tooltip>
        </CircleMarker>
      )}
      {destination && (
        <CircleMarker
          center={destination}
          radius={7}
          pathOptions={{ color: "#fff", weight: 2, fillColor: "#a78bfa", fillOpacity: 1 }}
        >
          <Tooltip permanent direction="right">
            <span className="font-sans text-xs font-semibold">Destination</span>
          </Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  )
}
