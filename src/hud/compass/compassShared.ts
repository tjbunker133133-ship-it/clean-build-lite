import type { CompassStatus } from '../../lib/deviceHeading'

export type CompassBaseProps = {
  heading: number | null
  status: CompassStatus
  cardinal: string
  size?: number
  onRequestPermission?: () => void
}

export function buildCompassAriaLabel(
  status: CompassStatus,
  heading: number | null,
  cardinal: string,
  needsPermission: boolean,
): string {
  if (status === 'unavailable') {
    return needsPermission ? 'Compass — tap to enable' : 'Compass unavailable'
  }
  if (status === 'level') return 'Compass paused — hold phone upright'
  if (heading == null) return 'Compass calibrating'
  return `Heading ${Math.round(heading)} degrees ${cardinal}`
}
