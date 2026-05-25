import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TACTICAL_PROFILE_CHANGED_EVENT,
  assessTacticalProfile,
  loadTacticalProfile,
  saveTacticalProfile,
  type TacticalProfile,
  type TacticalProfileAssessment,
} from '../lib/tacticalProfile'

export function useTacticalProfile(): {
  profile: TacticalProfile
  assessment: TacticalProfileAssessment
  operationalReady: boolean
  save: typeof saveTacticalProfile
  refresh: () => void
} {
  const [profile, setProfile] = useState<TacticalProfile>(() => loadTacticalProfile())

  const refresh = useCallback(() => {
    setProfile(loadTacticalProfile())
  }, [])

  useEffect(() => {
    const onChange = () => refresh()
    window.addEventListener(TACTICAL_PROFILE_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(TACTICAL_PROFILE_CHANGED_EVENT, onChange)
  }, [refresh])

  const save = useCallback(
    (...args: Parameters<typeof saveTacticalProfile>) => {
      const next = saveTacticalProfile(...args)
      setProfile(next)
      return next
    },
    [],
  )

  const assessment = useMemo(() => assessTacticalProfile(profile), [profile])

  return {
    profile,
    assessment,
    operationalReady: assessment.operationalReady,
    save,
    refresh,
  }
}
