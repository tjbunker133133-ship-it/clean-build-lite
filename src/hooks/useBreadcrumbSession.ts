import { useEffect, useState } from 'react'
import {
  clearBreadcrumbSession,
  getBreadcrumbSessionSnapshot,
  subscribeBreadcrumbSession,
  type BreadcrumbSessionSnapshot,
} from '../lib/movement/breadcrumbSessionStore'

export function useBreadcrumbSession(): BreadcrumbSessionSnapshot & { clearSession: () => void } {
  const [s, setS] = useState<BreadcrumbSessionSnapshot>(() => getBreadcrumbSessionSnapshot())

  useEffect(() => subscribeBreadcrumbSession(setS), [])

  return {
    ...s,
    clearSession: clearBreadcrumbSession,
  }
}
