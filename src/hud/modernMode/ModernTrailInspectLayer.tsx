import { logModernGuardrailApplied } from '../../lib/modernLayerGuardrails'
import { useModernTrailInspect } from '../../hooks/useModernTrailInspect'
import { ModernTrailInspectCard } from './ModernTrailInspectCard'

logModernGuardrailApplied('ModernTrailInspectLayer')

export function ModernTrailInspectLayer() {
  const trail = useModernTrailInspect()

  if (!trail.selection) return null

  return <ModernTrailInspectCard result={trail.selection} onDismiss={trail.dismiss} />
}

export default ModernTrailInspectLayer
