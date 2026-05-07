/**
 * Legacy API kept for backwards compatibility.
 *
 * Internally delegates to `src/runtime/deviceProfile.ts`, which is the single
 * source of truth for device classification. New code should import from
 * `runtime/deviceProfile` directly.
 */
import { getDeviceProfile } from '../runtime/deviceProfile'

export const getDeviceEnvironment = () => {
  const p = getDeviceProfile()
  return {
    isTouchDevice: p.isTouch,
    isCompactLayout: p.width > 0 ? p.width < 900 : false,
    isMobileEnvironment: p.interactionMode === 'mobile',
    width: p.width,
    height: p.height,
  }
}
