/**
 * Imperative confirm dialog — replaces window.confirm for field-safe UX.
 * Renders via HudConfirmHost (mounted in App root).
 */

export type HudConfirmRequest = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type Resolver = (value: boolean) => void

let activeResolver: Resolver | null = null
let listeners: Array<(req: HudConfirmRequest | null) => void> = []

export function subscribeHudConfirm(listener: (req: HudConfirmRequest | null) => void): () => void {
  listeners.push(listener)
  return () => {
    listeners = listeners.filter((l) => l !== listener)
  }
}

function emit(req: HudConfirmRequest | null) {
  for (const l of listeners) l(req)
}

export function hudConfirm(request: HudConfirmRequest): Promise<boolean> {
  if (activeResolver) {
    return Promise.resolve(false)
  }
  return new Promise((resolve) => {
    activeResolver = resolve
    emit(request)
  })
}

export function resolveHudConfirm(confirmed: boolean): void {
  const resolve = activeResolver
  activeResolver = null
  emit(null)
  resolve?.(confirmed)
}
