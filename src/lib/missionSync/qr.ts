import QRCode from 'qrcode'
import { packetFitsCompactQr } from './codec'

export async function missionPacketToQrDataUrl(encoded: string): Promise<string | null> {
  if (!packetFitsCompactQr(encoded)) return null
  try {
    return await QRCode.toDataURL(encoded, {
      margin: 1,
      width: 280,
      errorCorrectionLevel: 'L',
    })
  } catch {
    return null
  }
}

export type BarcodeScanResult = { raw: string } | null

export type MissionQrScanResult =
  | { ok: true; raw: string }
  | {
      ok: false
      reason: 'unsupported' | 'permission_denied' | 'timeout' | 'cancelled' | 'error'
      message: string
    }

type BarcodeDetectorLike = new (opts: { formats: string[] }) => {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
}

function getBarcodeDetector(): BarcodeDetectorLike | null {
  return (
    globalThis as unknown as { BarcodeDetector?: BarcodeDetectorLike }
  ).BarcodeDetector ?? null
}

/**
 * Scan mission QR into a visible <video> element (must be in DOM).
 * Caller owns preview mount; stream is always stopped on exit.
 */
export async function scanMissionPacketWithPreview(
  video: HTMLVideoElement,
  signal?: AbortSignal,
  maxMs = 30_000,
): Promise<MissionQrScanResult> {
  const Detector = getBarcodeDetector()
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    return {
      ok: false,
      reason: 'unsupported',
      message: 'QR scan needs Chrome or Edge with camera support. Paste join bundle instead.',
    }
  }

  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    })
  } catch (err) {
    const denied = err instanceof DOMException && err.name === 'NotAllowedError'
    return {
      ok: false,
      reason: 'permission_denied',
      message: denied
        ? 'Camera blocked — allow camera for this site in browser settings, then retry.'
        : 'Could not open camera — paste join bundle or enter mission code.',
    }
  }

  video.srcObject = stream
  video.setAttribute('playsinline', 'true')
  video.muted = true
  try {
    await video.play()
  } catch {
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
    return { ok: false, reason: 'error', message: 'Camera preview failed to start.' }
  }

  const detector = new Detector({ formats: ['qr_code'] })
  const deadline = Date.now() + maxMs

  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) {
        return { ok: false, reason: 'cancelled', message: 'Scan cancelled.' }
      }
      const codes = await detector.detect(video)
      const hit = codes.find((c) => typeof c.rawValue === 'string' && c.rawValue.length > 0)
      if (hit?.rawValue) return { ok: true, raw: hit.rawValue }
      await new Promise((r) => window.setTimeout(r, 200))
    }
    return {
      ok: false,
      reason: 'timeout',
      message: 'No QR detected — hold code steady, improve light, or paste join bundle.',
    }
  } finally {
    stream.getTracks().forEach((t) => t.stop())
    video.srcObject = null
  }
}

// scanMissionPacketFromCamera removed - use scanMissionPacketWithPreview with mounted video element
