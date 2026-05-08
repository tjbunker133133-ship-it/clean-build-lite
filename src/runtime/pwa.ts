/**
 * PWA INSTALL MODE BROKER.
 *
 * Single runtime-owned source of truth for "is this app running as an
 * installed PWA, and can it be installed?". Captures the Android
 * `beforeinstallprompt` event for later user-driven activation,
 * mirrors `display-mode: standalone` matchMedia changes, and exposes a
 * minimal listener interface for `runtimeSnapshot` to mirror its state.
 *
 * Design rules:
 *   - No React state, no UI, no automatic prompt triggering.
 *   - Capability-gated: silent no-op in non-browser environments.
 *   - Dependency-free regarding `runtimeSnapshot.ts` (avoids cycles);
 *     the snapshot wires a listener via `setInstallModeListener`.
 *   - Idempotent: `installPwaWatcher()` is safe to call multiple times.
 *
 * Eligibility model:
 *   - Android: eligible only after `beforeinstallprompt` was captured
 *     (i.e. the browser actually offered an installable manifest).
 *   - iOS: eligible whenever the app is loaded in a browser (not yet
 *     standalone) on iOS, since iOS Safari's "Add to Home Screen" lives
 *     in the OS Share sheet — there is no programmatic prompt API.
 *   - Desktop / unknown: never eligible from this broker; install is
 *     handled by the browser's address-bar UI.
 */

import { getDeviceProfile } from './deviceProfile'
import { logInfo } from './logger'

// ---------- public types ----------

export type InstallPlatform = 'ios' | 'android' | 'desktop' | 'unknown'

export interface InstallMode {
  /** Running as installed PWA (display-mode standalone, or iOS legacy `navigator.standalone`). */
  standalone: boolean
  /** Running in a regular browser tab (inverse of `standalone`). */
  browser: boolean
  /** App can be installed from the current context. */
  eligible: boolean
  /** Coarse platform classification used to choose guidance content. */
  platform: InstallPlatform
  /**
   * Android only: a `beforeinstallprompt` event has been captured and
   * is still callable. Reset to `false` after the user accepts/dismisses
   * the prompt or the page reloads.
   */
  promptAvailable: boolean
  /** Last time any of the above changed. */
  lastTransitionAt: number
}

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable'

// ---------- internal state ----------

/**
 * The W3C `BeforeInstallPromptEvent` shape. Typed locally because it is
 * not part of the standard lib.dom.d.ts surface in many TS configs.
 */
interface BeforeInstallPromptEventLike extends Event {
  readonly platforms: ReadonlyArray<string>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt(): Promise<void>
}

let deferredPrompt: BeforeInstallPromptEventLike | null = null
let installed = false
let listener: ((m: InstallMode) => void) | null = null
let lastTransitionAt = Date.now()

// ---------- detection helpers ----------

function detectPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'unknown'
  const profile = getDeviceProfile()
  if (profile.isIOS) return 'ios'
  if (profile.isAndroid) return 'android'
  if (profile.type === 'desktop') return 'desktop'
  return 'unknown'
}

function detectStandalone(): boolean {
  // Single source of truth: the device profile already computes both
  // `display-mode: standalone` and the iOS legacy navigator.standalone
  // signal. We delegate to it so all consumers agree.
  return getDeviceProfile().isStandalone
}

// ---------- public API ----------

export function getInstallMode(): InstallMode {
  const standalone = detectStandalone()
  const platform = detectPlatform()
  const promptAvailable = deferredPrompt != null
  // iOS Safari's "Add to Home Screen" works for any iOS browser even
  // without a beforeinstallprompt event. We mark iOS browser tabs as
  // eligible whenever they aren't already standalone — guidance text
  // (the Share-sheet hint) is the actionable path on that platform.
  const iosEligible = platform === 'ios' && !standalone
  const androidEligible = platform === 'android' && !standalone && promptAvailable
  const eligible = !standalone && (iosEligible || androidEligible)
  return {
    standalone,
    browser: !standalone,
    eligible,
    platform,
    promptAvailable,
    lastTransitionAt,
  }
}

export function setInstallModeListener(fn: ((m: InstallMode) => void) | null): void {
  listener = fn
  if (fn) fn(getInstallMode())
}

function notify(): void {
  if (!listener) return
  try {
    listener(getInstallMode())
  } catch {
    // listener errors must never disturb runtime
  }
}

/**
 * User-driven Android install. Returns the outcome of the prompt or
 * `'unavailable'` if no `beforeinstallprompt` event has been captured.
 * Always resolves; never throws.
 */
export async function triggerInstallPrompt(): Promise<InstallPromptOutcome> {
  const ev = deferredPrompt
  if (!ev) return 'unavailable'
  try {
    await ev.prompt()
    const choice = await ev.userChoice
    logInfo('PWA', `[PWA] install prompt outcome=${choice.outcome} platform=${choice.platform}`)
    deferredPrompt = null
    lastTransitionAt = Date.now()
    notify()
    return choice.outcome
  } catch {
    deferredPrompt = null
    lastTransitionAt = Date.now()
    notify()
    return 'unavailable'
  }
}

const HINT_DISMISSED_KEY = 'hud_pwa_install_hint_dismissed_v1'

export function wasInstallHintDismissed(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(HINT_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissInstallHint(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(HINT_DISMISSED_KEY, '1')
    logInfo('PWA', '[PWA] install hint dismissed')
  } catch {
    // ignore
  }
}

/**
 * Wire window-level listeners for install-mode transitions. Idempotent.
 * Should be called once during runtime bootstrap (after the snapshot is
 * installed) so the listener mirror has a target.
 */
export function installPwaWatcher(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const initial = getInstallMode()
  logInfo(
    'PWA',
    `[PWA] init standalone=${initial.standalone} platform=${initial.platform} eligible=${initial.eligible}`,
  )

  // Android Chrome / Edge / Samsung Internet emit this when the manifest
  // is installable. We capture and defer it so the user — not the page —
  // decides when to show the install prompt.
  window.addEventListener('beforeinstallprompt', (ev: Event) => {
    ev.preventDefault()
    deferredPrompt = ev as unknown as BeforeInstallPromptEventLike
    lastTransitionAt = Date.now()
    logInfo('PWA', '[PWA] install prompt available (beforeinstallprompt captured)')
    notify()
  })

  // Fired by all major engines on successful install. We clear the
  // deferred prompt to avoid stale state if the user installs via the
  // browser's own UI rather than ours.
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    lastTransitionAt = Date.now()
    logInfo('PWA', '[PWA] app installed')
    notify()
  })

  // `display-mode: standalone` matchMedia transitions when the user
  // launches the installed PWA from the Home Screen vs. opens it in a
  // tab. Mirroring this keeps `installMode.standalone` accurate without
  // requiring a page reload.
  try {
    const mq = window.matchMedia('(display-mode: standalone)')
    const onChange = () => {
      lastTransitionAt = Date.now()
      logInfo('PWA', `[PWA] display-mode change standalone=${mq.matches}`)
      notify()
    }
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
    } else if (typeof (mq as MediaQueryList & { addListener?: (cb: () => void) => void }).addListener === 'function') {
      ;(mq as MediaQueryList & { addListener: (cb: () => void) => void }).addListener(onChange)
    }
  } catch {
    // Some legacy browsers throw on matchMedia change subscriptions.
    // The initial detection still works via getDeviceProfile().
  }

  // Devtools convenience hook. Read-only in spirit; `install()` requires
  // a real captured prompt so it cannot be used to spam the user.
  ;(window as Window & {
    __hudPWA?: {
      get: () => InstallMode
      install: () => Promise<InstallPromptOutcome>
      dismissHint: () => void
      wasHintDismissed: () => boolean
    }
  }).__hudPWA = {
    get: getInstallMode,
    install: triggerInstallPrompt,
    dismissHint: dismissInstallHint,
    wasHintDismissed: wasInstallHintDismissed,
  }

  // Initial notify so any listener registered before this watcher
  // installed receives the boot value.
  notify()
}
