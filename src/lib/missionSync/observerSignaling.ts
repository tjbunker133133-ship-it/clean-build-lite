import type { SyncWireMessage } from './types'
import {
  ObserverMonitorChannel,
  isObserverMonitorChannelAvailable,
  type ObserverSignalMessage,
} from './observerMonitorChannel'

export type { ObserverSignalMessage }

export function isObserverSignalingAvailable(): boolean {
  return isObserverMonitorChannelAvailable()
}

export async function publishObserverSignal(
  missionId: string,
  observerToken: string,
  message: ObserverSignalMessage,
): Promise<boolean> {
  if (!isObserverMonitorChannelAvailable()) return false
  const ch = new ObserverMonitorChannel(missionId, observerToken)
  try {
    return await ch.publishSignal(message)
  } finally {
    ch.dispose()
  }
}

export async function publishObserverRelay(
  missionId: string,
  observerToken: string,
  wire: SyncWireMessage,
  fromDeviceId: string,
): Promise<boolean> {
  if (!isObserverMonitorChannelAvailable()) return false
  const ch = new ObserverMonitorChannel(missionId, observerToken)
  try {
    return await ch.publishRelay(wire, fromDeviceId)
  } finally {
    ch.dispose()
  }
}

export { ObserverMonitorChannel } from './observerMonitorChannel'

export function subscribeObserverSignals(
  missionId: string,
  observerToken: string,
  handlers: {
    onOffer?: (msg: Extract<ObserverSignalMessage, { kind: 'offer' }>) => void
    onAnswer?: (msg: Extract<ObserverSignalMessage, { kind: 'answer' }>) => void
    onRelay?: (wire: SyncWireMessage, fromDeviceId: string, at: number) => void
  },
): () => void {
  if (!isObserverMonitorChannelAvailable()) return () => {}
  const ch = new ObserverMonitorChannel(missionId, observerToken)
  return ch.connect(handlers)
}

/** @deprecated Prefer buildWatchMeInviteText + buildWatchMeUrl — kept for offline bundle share. */
export function buildMonitorInviteText(args: {
  missionName: string
  missionId: string
  observerToken: string
  watchUrl?: string
}): string {
  if (args.watchUrl) {
    return [
      `Signal One — watch ${args.missionName}`,
      '',
      'Tap this link on your phone (no copy/paste):',
      args.watchUrl,
    ].join('\n')
  }
  return [
    'Signal One — Mission Monitor',
    `Mission: ${args.missionName}`,
    `ID: ${args.missionId}`,
    `Monitor token: ${args.observerToken}`,
    '',
    'Advanced: Mission Link → paste token (link share is preferred).',
  ].join('\n')
}
