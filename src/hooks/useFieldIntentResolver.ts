import { useEffect, useRef } from 'react'
import type { FieldIntent } from '../lib/fieldIntentModel'
import { setFieldIntent } from '../lib/fieldIntentStore'
import { deriveFieldIntent } from '../lib/resolveFieldIntent'
import { logModernGuardrailTransition } from '../lib/modernLayerGuardrails'

export type FieldIntentResolverInput = {
  immersive: boolean
  zoom: number
  navigating: boolean
  storm: boolean
  emergency: boolean
  systemFailure: boolean
}

/**
 * Resolves and commits fieldIntent from runtime signals.
 * The only automatic write path for field intent.
 */
export function useFieldIntentResolver(input: FieldIntentResolverInput): void {
  const prevIntentRef = useRef<FieldIntent | null>(null)

  useEffect(() => {
    if (!input.immersive) return

    const intent = deriveFieldIntent({
      zoom: input.zoom,
      navigating: input.navigating,
      storm: input.storm,
      emergency: input.emergency,
      systemFailure: input.systemFailure,
    })

    if (prevIntentRef.current !== intent) {
      prevIntentRef.current = intent
      logModernGuardrailTransition('field-intent', {
        intent,
        zoom: input.zoom.toFixed(1),
        navigating: input.navigating,
        storm: input.storm,
        systemFailure: input.systemFailure,
      })
    }

    setFieldIntent(intent)
  }, [
    input.immersive,
    input.zoom,
    input.navigating,
    input.storm,
    input.emergency,
    input.systemFailure,
  ])
}
