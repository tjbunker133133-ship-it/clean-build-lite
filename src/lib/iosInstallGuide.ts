/**
 * Copy for iPhone / iPad — Apple has no Android-style install prompt.
 * Users add the PWA via Share → Add to Home Screen (not a bookmark).
 */

import { getDeviceProfile } from '../runtime/deviceProfile'

export type IosInstallCopy = {
  title: string
  lead: string
  steps: string[]
  avoid: string
}

export function iosInstallCopy(isTablet: boolean): IosInstallCopy {
  const shareWhere = isTablet
    ? 'Tap Share at the top of Safari (square with arrow up)'
    : 'Tap Share at the bottom of Safari (square with arrow up)'
  return {
    title: 'ADD TO HOME SCREEN',
    lead: 'Apple does not offer a one-tap Install button. This creates an app icon — not a bookmark.',
    steps: [
      shareWhere,
      'Scroll the menu and tap Add to Home Screen',
      'Tap Add (top right), then open HUD V1 from your Home Screen',
    ],
    avoid: 'Skip Add Bookmark and Add to Favorites — those stay inside Safari only.',
  }
}

export function isIphoneOrIpadBrowserTab(): boolean {
  if (typeof window === 'undefined') return false
  const p = getDeviceProfile()
  return p.isIOS && !p.isStandalone
}
