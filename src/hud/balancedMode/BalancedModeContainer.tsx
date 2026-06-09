/**
 * Balanced Mode Container
 * ========================
 *
 * Mounts BalancedWorkspaceProvider — all panel/tool state lives in BalancedLayer.
 */

import React from 'react'
import BalancedLayer from './BalancedLayer'
import { BalancedWorkspaceProvider } from './hooks/useBalancedWorkspace'

export default function BalancedModeContainer() {
  return (
    <BalancedWorkspaceProvider>
      <BalancedLayer />
    </BalancedWorkspaceProvider>
  )
}
