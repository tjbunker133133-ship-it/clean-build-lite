/**
 * Modern-only map subsystems — mounted ONLY in Modern (immersive) map stack.
 * Never mount in Classic or Balanced paths.
 */

import { FieldEngineLoop } from '../field/FieldEngineLoop'
import { FieldNavigationHint } from '../field/FieldNavigationHint'
import { ModernCameraController } from './ModernCameraController'
import { WaypointProximityLayer } from './WaypointProximityLayer'
import { RouteAtmosphereLayer } from './RouteAtmosphereLayer'
import { ModernUserLocatorLayer } from './ModernUserLocatorLayer'
import { WeatherRadarLayer } from './WeatherRadarLayer'
import { ModernOverlayAtmosphere } from './ModernOverlayAtmosphere'
import { MapMeasureLayer } from './MapMeasureLayer'

export function ModernMapSubsystems() {
  return (
    <>
      <WeatherRadarLayer />
      <ModernOverlayAtmosphere />
      <FieldEngineLoop />
      <FieldNavigationHint />
      <ModernCameraController />
      <WaypointProximityLayer />
      <RouteAtmosphereLayer />
      <ModernUserLocatorLayer />
      <MapMeasureLayer />
    </>
  )
}

export default ModernMapSubsystems
