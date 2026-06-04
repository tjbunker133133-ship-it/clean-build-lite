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

export function buildMonitorInviteText(args: {
  missionName: string
  missionId: string
  observerToken: string
}): string {
  return [
    'Signal One — Mission Monitor',
    `Mission: ${args.missionName}`,
    `ID: ${args.missionId}`,
    `Monitor token: ${args.observerToken}`,
    '',
    'In the app: Mission Link → Monitor mission → paste token or monitor bundle.',
  ].join('\n')
}
