/**
 * MAP LAYER REGISTRY — PRODUCTION HARDENING (CRITICAL FIX #4)
 *
 * Eliminates MapLibre layer duplication after style reloads and prevents ghost overlays.
 *
 * PROBLEM:
 * - maplibre emits styledata, style.load, sourcedata events
 * - if layers re-add on each event → duplicate layers accumulate
 * - GPU memory grows silently; ghost overlays remain after reload
 *
 * SOLUTION:
 * - Global registry tracks added layer/source IDs per session
 * - Before adding layer: if registry.has(layerId) → SKIP
 * - On styledata complete: clear registry + rehydrate layers ONCE
 * - All add operations guarded: map.getSource/getLayer checks
 *
 * RESULT:
 * - zero duplication risk
 * - stable GPU usage
 * - safe style reload recovery
 */

import type maplibregl from 'maplibre-gl'

export interface LayerRegistrySnapshot {
  layerIds: Set<string>
  sourceIds: Set<string>
  sessionStartMs: number
  lastStyleReloadMs: number | null
}

class MapLayerRegistry {
  private layerIds = new Set<string>()
  private sourceIds = new Set<string>()
  private sessionStartMs = Date.now()
  private lastStyleReloadMs: number | null = null

  /**
   * Call when map receives styledata event (style was reset).
   * Clears registry to allow re-binding of layers on new style.
   */
  onStyleReset() {
    this.lastStyleReloadMs = Date.now()
    this.layerIds.clear()
    this.sourceIds.clear()
  }

  /**
   * Check if layer already added in this session.
   * Returns true if layer exists AND we haven't seen a style reset since.
   */
  shouldSkipLayer(map: maplibregl.Map, layerId: string): boolean {
    // First, confirm layer actually exists on map
    const layerExists = map.getLayer(layerId) !== undefined

    // If layer doesn't exist on map, we should add it (don't skip)
    if (!layerExists) {
      return false
    }

    // Layer exists on map AND in our registry → skip
    if (this.layerIds.has(layerId)) {
      return true
    }

    return false
  }

  /**
   * Check if source already added in this session.
   * Returns true if source exists AND we haven't seen a style reset since.
   */
  shouldSkipSource(map: maplibregl.Map, sourceId: string): boolean {
    // First, confirm source actually exists on map
    const sourceExists = map.getSource(sourceId) !== undefined

    // If source doesn't exist on map, we should add it (don't skip)
    if (!sourceExists) {
      return false
    }

    // Source exists on map AND in our registry → skip
    if (this.sourceIds.has(sourceId)) {
      return true
    }

    return false
  }

  /**
   * Register that we successfully added a layer.
   * Call this AFTER map.addLayer() completes.
   */
  registerLayer(layerId: string) {
    this.layerIds.add(layerId)
  }

  /**
   * Register that we successfully added a source.
   * Call this AFTER map.addSource() completes.
   */
  registerSource(sourceId: string) {
    this.sourceIds.add(sourceId)
  }

  /**
   * Get current registry state (for debugging / telemetry).
   */
  getSnapshot(): LayerRegistrySnapshot {
    return {
      layerIds: new Set(this.layerIds),
      sourceIds: new Set(this.sourceIds),
      sessionStartMs: this.sessionStartMs,
      lastStyleReloadMs: this.lastStyleReloadMs
    }
  }

  /**
   * Get count of registered layers.
   */
  getLayerCount(): number {
    return this.layerIds.size
  }

  /**
   * Get count of registered sources.
   */
  getSourceCount(): number {
    return this.sourceIds.size
  }
}

/**
 * SINGLETON INSTANCE — shared across all Modern Layer map components.
 * Initialized once per session; reset on styledata event.
 */
let registryInstance: MapLayerRegistry | null = null

export function getMapLayerRegistry(): MapLayerRegistry {
  if (!registryInstance) {
    registryInstance = new MapLayerRegistry()
  }
  return registryInstance
}

/**
 * SAFE ADD LAYER PATTERN:
 *
 * Usage:
 * ```typescript
 * const registry = getMapLayerRegistry()
 *
 * if (!registry.shouldSkipLayer(map, 'my-layer-id')) {
 *   map.addLayer({
 *     id: 'my-layer-id',
 *     source: 'my-source-id',
 *     type: 'fill',
 *     paint: { ... }
 *   })
 *   registry.registerLayer('my-layer-id')
 * }
 * ```
 */

/**
 * SAFE ADD SOURCE PATTERN:
 *
 * Usage:
 * ```typescript
 * const registry = getMapLayerRegistry()
 *
 * if (!registry.shouldSkipSource(map, 'my-source-id')) {
 *   map.addSource('my-source-id', {
 *     type: 'geojson',
 *     data: { type: 'FeatureCollection', features: [] }
 *   })
 *   registry.registerSource('my-source-id')
 * }
 * ```
 */

/**
 * ON STYLEDATA EVENT:
 *
 * Usage in component:
 * ```typescript
 * const onStyleData = () => {
 *   const registry = getMapLayerRegistry()
 *   registry.onStyleReset()
 *   scheduleRehydrateLayers()
 * }
 *
 * useEffect(() => {
 *   map.on('styledata', onStyleData)
 *   return () => map.off('styledata', onStyleData)
 * }, [map])
 * ```
 */

/**
 * LAYER REHYDRATION PATTERN (called after styledata):
 *
 * Usage:
 * ```typescript
 * function rehydrateLayers(map: maplibregl.Map) {
 *   // Use registry to skip any layers that are already on map
 *   const registry = getMapLayerRegistry()
 *
 *   // Example: re-add proximity ring layer
 *   if (!registry.shouldSkipSource(map, 'proximity-source')) {
 *     map.addSource('proximity-source', {...})
 *     registry.registerSource('proximity-source')
 *   }
 *
 *   if (!registry.shouldSkipLayer(map, 'proximity-ring-layer')) {
 *     map.addLayer({ id: 'proximity-ring-layer', ... })
 *     registry.registerLayer('proximity-ring-layer')
 *   }
 * }
 * ```
 */
