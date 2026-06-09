/**
 * Balanced-only map subsystems — field engine without Modern camera/locator stack.
 */

import { FieldEngineLoop } from '../field/FieldEngineLoop'
import { MapMeasureLayer } from './MapMeasureLayer'
import { WeatherRadarLayer } from './WeatherRadarLayer'

export function BalancedMapSubsystems() {
  return (
    <>
      <FieldEngineLoop />
      <MapMeasureLayer />
      <WeatherRadarLayer />
    </>
  )
}

export default BalancedMapSubsystems
