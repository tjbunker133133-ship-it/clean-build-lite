/**
 * Share mission join/answer bundles offline or online — one tap for operators.
 * Native Android: system share sheet (Bluetooth, SMS, Drive, etc.).
 * Browser: Web Share API when available, else clipboard + optional file download.
 */

export type ShareBundleResult = 'shared' | 'copied' | 'downloaded' | 'failed'

export type ShareBundleOptions = {
  title?: string
  /** When true, always copy to clipboard even if share sheet opened. */
  alsoCopy?: boolean
  filename?: string
}

export async function copyMissionBundle(text: string): Promise<boolean> {
  const trimmed = text.trim()
  if (!trimmed) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(trimmed)
      return true
    }
  } catch {
    /* fallback below */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = trimmed
    ta.setAttribute('readonly', '')
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

export async function readMissionBundleFromClipboard(): Promise<string | null> {
  try {
    if (navigator.clipboard?.readText) {
      const t = await navigator.clipboard.readText()
      return t?.trim() ? t.trim() : null
    }
  } catch {
    return null
  }
  return null
}

async function shareViaNativeSheet(text: string, title: string): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return false
    const { Share } = await import('@capacitor/share')
    await Share.share({
      title,
      text,
      dialogTitle: title,
    })
    return true
  } catch {
    return false
  }
}

async function shareViaWebApi(text: string, title: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.share) return false
  try {
    await navigator.share({ title, text })
    return true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return true
    return false
  }
}

export function downloadMissionBundle(text: string, filename = 'signal-one-mission-link.txt'): void {
  const trimmed = text.trim()
  if (!trimmed || typeof document === 'undefined') return
  const blob = new Blob([trimmed], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Best-effort share: native sheet → Web Share → clipboard → file download.
 */
export async function shareMissionBundle(
  text: string,
  opts: ShareBundleOptions = {},
): Promise<ShareBundleResult> {
  const trimmed = text.trim()
  if (!trimmed) return 'failed'

  const title = opts.title ?? 'Signal One mission link'
  const filename = opts.filename ?? 'signal-one-mission-link.txt'

  if (await shareViaNativeSheet(trimmed, title)) {
    if (opts.alsoCopy) await copyMissionBundle(trimmed)
    return 'shared'
  }
  if (await shareViaWebApi(trimmed, title)) {
    if (opts.alsoCopy) await copyMissionBundle(trimmed)
    return 'shared'
  }
  if (await copyMissionBundle(trimmed)) {
    return 'copied'
  }
  downloadMissionBundle(trimmed, filename)
  return 'downloaded'
}
