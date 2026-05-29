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

/** Android Chrome tablet — optional camera scan. */
export async function scanMissionPacketFromCamera(): Promise<BarcodeScanResult> {
  const Detector = (globalThis as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => {
    detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>
  } }).BarcodeDetector
  if (!Detector || !navigator.mediaDevices?.getUserMedia) return null

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false,
  })

  const video = document.createElement('video')
  video.setAttribute('playsinline', 'true')
  video.srcObject = stream
  await video.play()

  const detector = new Detector({ formats: ['qr_code'] })
  const deadline = Date.now() + 25_000
  try {
    while (Date.now() < deadline) {
      const codes = await detector.detect(video)
      const hit = codes.find((c) => typeof c.rawValue === 'string' && c.rawValue.length > 0)
      if (hit?.rawValue) return { raw: hit.rawValue }
      await new Promise((r) => window.setTimeout(r, 250))
    }
    return null
  } finally {
    stream.getTracks().forEach((t) => t.stop())
    video.remove()
  }
}
