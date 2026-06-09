/**
 * Device density for Modern field rendering — single visual system, adaptive density.
 */

import { useEffect, useState } from 'react'

export type ModernDeviceDensity = 'mobile' | 'tablet' | 'desktop'

function resolveDensity(width: number): ModernDeviceDensity {
  if (width < 768) return 'mobile'
  if (width < 1100) return 'tablet'
  return 'desktop'
}

export function useModernDeviceDensity(): ModernDeviceDensity {
  const [density, setDensity] = useState<ModernDeviceDensity>(() => {
    if (typeof window === 'undefined') return 'mobile'
    return resolveDensity(window.innerWidth)
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const apply = () => {
      const next = resolveDensity(window.innerWidth)
      setDensity(next)
      document.documentElement.setAttribute('data-modern-device', next)
    }

    apply()
    window.addEventListener('resize', apply)
    return () => {
      window.removeEventListener('resize', apply)
      document.documentElement.removeAttribute('data-modern-device')
    }
  }, [])

  return density
}

export default useModernDeviceDensity
