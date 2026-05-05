/**
 * Best-effort deep links to system location / privacy screens.
 * iOS Safari often blocks or ignores these; always pair with manual steps + clipboard fallback.
 */

const IOS_LOCATION_PREFS = ['App-Prefs:root=Privacy&path=LOCATION', 'prefs:root=Privacy&path=LOCATION'] as const

const ANDROID_LOCATION_INTENT =
  'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end'

export function isAppleMobileUa(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPhone|iPad|iPod/i.test(navigator.userAgent || '')
}

export function isAndroidUa(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android/i.test(navigator.userAgent || '')
}

/** Try to jump to iOS Settings → Privacy → Location Services. May no-op on newer iOS. */
export function tryOpenIosLocationPrivacySettings(): void {
  if (typeof window === 'undefined') return
  const url = IOS_LOCATION_PREFS[0]
  window.location.assign(url)
}

/** Second legacy prefs URL; some iOS builds respond to one and not the other. */
export function tryOpenIosLocationPrivacySettingsAlternate(): void {
  if (typeof window === 'undefined') return
  window.location.assign(IOS_LOCATION_PREFS[1])
}

/** Try Android location source settings (Chrome / system browser). */
export function tryOpenAndroidLocationSettings(): void {
  if (typeof window === 'undefined') return
  window.location.assign(ANDROID_LOCATION_INTENT)
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export function safariLocationFixClipboardLines(): string {
  return [
    'Tactical HUD — enable location (Safari / iPhone)',
    '1) Settings → Privacy & Security → Location Services → ON',
    '2) Settings → Safari → Location → While Using or Ask',
    '3) Safari → aA → Website Settings → Location → Allow or Ask',
    '4) If Home Screen app: Settings → [app name] → Location → While Using',
    '5) Return to HUD → tap PROMPT GPS or LOCATION in permissions',
  ].join('\n')
}

export function androidLocationFixClipboardLines(): string {
  return [
    'Tactical HUD — enable location (Android)',
    '1) Settings → Location ON',
    '2) Chrome → ⋮ → Settings → Site settings → Location → allow this site',
    '3) Return to HUD → tap PROMPT GPS',
  ].join('\n')
}
