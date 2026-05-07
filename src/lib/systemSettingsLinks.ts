/**
 * Best-effort deep links to system location / privacy screens.
 * iOS Safari often blocks or ignores these; always pair with manual steps + clipboard fallback.
 */

import { classifySystemNavScheme, emitSystemNav } from '../diag/devEvents'
import { getDeviceProfile } from '../runtime/deviceProfile'

const IOS_LOCATION_PREFS = ['App-Prefs:root=Privacy&path=LOCATION', 'prefs:root=Privacy&path=LOCATION'] as const

const ANDROID_LOCATION_INTENT =
  'intent:#Intent;action=android.settings.LOCATION_SOURCE_SETTINGS;end'

const IOS_LOCATION_FALLBACK_TEXT =
  'Open Settings manually in iPhone Settings > Privacy > Location'
const ANDROID_LOCATION_FALLBACK_TEXT =
  'Open Settings manually in Android Settings > Location'

export type SystemNavigationFallback = (message: string) => void

/** Delegates to unified device profile. iPad with desktop-class UA is correctly recognized. */
export function isAppleMobileUa(): boolean {
  return getDeviceProfile().isIOS
}

export function isAndroidUa(): boolean {
  return getDeviceProfile().isAndroid
}

/**
 * Safely attempt a system-scheme navigation (iOS `App-Prefs:` / `prefs:`, Android `intent:`)
 * without surfacing the browser's generic "address invalid" sheet on the visible page.
 *
 * Strategy:
 * - iOS prefs schemes are loaded via a hidden iframe so any OS-level scheme rejection
 *   stays in the iframe's navigation context, not the parent page.
 * - All schemes race a `visibilitychange` listener: if the OS consumes the URL the
 *   browser backgrounds and we cancel the fallback. Otherwise the timer fires and
 *   `onFallback(fallbackMessage)` runs so the caller can show in-app guidance.
 */
export function safeSystemNavigation(
  url: string,
  fallbackMessage: string,
  onFallback?: SystemNavigationFallback,
): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    onFallback?.(fallbackMessage)
    return
  }
  const scheme = classifySystemNavScheme(url)
  emitSystemNav({ phase: 'attempt', url, scheme, ts: Date.now() })
  const isIosPrefsScheme = scheme === 'ios-prefs'
  let consumed = false
  let timer: number | null = null
  let frame: HTMLIFrameElement | null = null

  const cleanup = (): void => {
    if (timer != null) {
      window.clearTimeout(timer)
      timer = null
    }
    window.removeEventListener('pagehide', onHide)
    document.removeEventListener('visibilitychange', onVis)
    if (frame && frame.parentNode) {
      frame.parentNode.removeChild(frame)
      frame = null
    }
  }
  const fire = (): void => {
    if (consumed) return
    consumed = true
    cleanup()
    emitSystemNav({ phase: 'fallback', url, scheme, ts: Date.now() })
    onFallback?.(fallbackMessage)
  }
  const consumeWithoutFallback = (): void => {
    if (consumed) return
    consumed = true
    cleanup()
    emitSystemNav({ phase: 'success', url, scheme, ts: Date.now() })
  }
  function onHide(): void {
    consumeWithoutFallback()
  }
  function onVis(): void {
    if (document.visibilityState === 'hidden') consumeWithoutFallback()
  }

  window.addEventListener('pagehide', onHide, { once: true })
  document.addEventListener('visibilitychange', onVis)
  timer = window.setTimeout(fire, 800)

  if (isIosPrefsScheme) {
    frame = document.createElement('iframe')
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;display:none;'
    frame.setAttribute('aria-hidden', 'true')
    document.body.appendChild(frame)
    try {
      frame.src = url
    } catch {
      fire()
    }
  } else {
    try {
      window.location.assign(url)
    } catch {
      fire()
    }
  }
}

/** Try to jump to iOS Settings → Privacy → Location Services. May no-op on newer iOS. */
export function tryOpenIosLocationPrivacySettings(
  onFallback?: SystemNavigationFallback,
): void {
  if (typeof window === 'undefined') return
  safeSystemNavigation(IOS_LOCATION_PREFS[0], IOS_LOCATION_FALLBACK_TEXT, onFallback)
}

/** Second legacy prefs URL; some iOS builds respond to one and not the other. */
export function tryOpenIosLocationPrivacySettingsAlternate(
  onFallback?: SystemNavigationFallback,
): void {
  if (typeof window === 'undefined') return
  safeSystemNavigation(IOS_LOCATION_PREFS[1], IOS_LOCATION_FALLBACK_TEXT, onFallback)
}

/** Try Android location source settings (Chrome / system browser). */
export function tryOpenAndroidLocationSettings(
  onFallback?: SystemNavigationFallback,
): void {
  if (typeof window === 'undefined') return
  safeSystemNavigation(ANDROID_LOCATION_INTENT, ANDROID_LOCATION_FALLBACK_TEXT, onFallback)
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
