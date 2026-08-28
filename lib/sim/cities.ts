import type { City, CityId } from "./types"

export const CITIES: Record<CityId, City> = {
  delhi: {
    id: "delhi",
    name: "Delhi",
    region: "Minto Bridge / ITO catchment (simulated)",
    center: [28.6289, 77.2405],
    spanLat: 0.016,
    spanLng: 0.02,
    gridN: 22,
    baseElevation: 210,
  },
  mumbai: {
    id: "mumbai",
    name: "Mumbai",
    region: "Hindmata / Dadar low-lying zone (simulated)",
    center: [19.0176, 72.844],
    spanLat: 0.016,
    spanLng: 0.02,
    gridN: 22,
    baseElevation: 8,
  },
  chennai: {
    id: "chennai",
    name: "Chennai",
    region: "Velachery / Adyar basin (simulated)",
    center: [12.9791, 80.2209],
    spanLat: 0.016,
    spanLng: 0.02,
    gridN: 22,
    baseElevation: 6,
  },
}

export const CITY_LIST = Object.values(CITIES)
