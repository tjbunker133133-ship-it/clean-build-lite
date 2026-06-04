import type { HealthConnectUiSnapshot } from './healthConnectFormat'

let cache: HealthConnectUiSnapshot | null = null

export function setWearablesHealthCache(snapshot: HealthConnectUiSnapshot | null): void {
  cache = snapshot
}

export function getWearablesHealthCache(): HealthConnectUiSnapshot | null {
  return cache
}
