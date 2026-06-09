/**
 * Balanced-only map subsystems — field engine without Modern camera/locator stack.
 */

import { FieldEngineLoop } from '../field/FieldEngineLoop'
import { MapMeasureLayer } from './MapMeasureLayer'
import { BalancedWeatherRadarLayer } from './BalancedWeatherRadarLayer'

export function BalancedMapSubsystems() {
  return (
    <>
      <FieldEngineLoop />
      <MapMeasureLayer />
      <BalancedWeatherRadarLayer />
    </>
  )
}

export default BalancedMapSubsystems
