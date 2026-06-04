import type { MissionCorridorHint, MissionSnapshot, SyncWireMessage } from './types'

/** Dedupe inbound sync wire messages (WebRTC or internet relay). */
export class SyncWireDedupe {
  private seenSnapshots = new Map<string, number>()
  private seenCorridorHints = new Map<string, number>()

  accept(msg: SyncWireMessage): boolean {
    if (msg.type === 'snapshot') {
      return this.acceptSnapshot(msg.payload)
    }
    if (msg.type === 'corridor-hint') {
      return this.acceptCorridorHint(msg.payload)
    }
    return true
  }

  private acceptSnapshot(payload: MissionSnapshot): boolean {
    const key = `${payload.sourceDeviceId}:${payload.revision}`
    const now = Date.now()
    const seenAt = this.seenSnapshots.get(key)
    if (seenAt != null && now - seenAt < 60_000) return false
    this.seenSnapshots.set(key, now)
    if (this.seenSnapshots.size > 96) {
      for (const [k, t] of this.seenSnapshots) {
        if (now - t > 60_000) this.seenSnapshots.delete(k)
      }
    }
    return true
  }

  private acceptCorridorHint(payload: MissionCorridorHint): boolean {
    const key = `${payload.sourceDeviceId}:${payload.routeFingerprint}:${payload.updatedAt}`
    const now = Date.now()
    const seenAt = this.seenCorridorHints.get(key)
    if (seenAt != null && now - seenAt < 120_000) return false
    this.seenCorridorHints.set(key, now)
    if (this.seenCorridorHints.size > 48) {
      for (const [k, t] of this.seenCorridorHints) {
        if (now - t > 120_000) this.seenCorridorHints.delete(k)
      }
    }
    return true
  }
}
