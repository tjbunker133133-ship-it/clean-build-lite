/**
 * Mode-scoped portal — mounts children into the active mode's portal root.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useHudPresentation } from '../../context/HudPresentationContext'
import { registerPortal, unregisterPortal, type PortalOwner } from './portalRegistry'
import {
  getGlobalOverlayTarget,
  getModePortalTarget,
  presentationModeToRootId,
  type ModeRootId,
} from './modeRoots'

type ModePortalProps = {
  children: ReactNode
  portalId: string
  /** Override owner; defaults to active presentation mode */
  owner?: PortalOwner
}

export function ModePortal({ children, portalId, owner }: ModePortalProps) {
  const { mode } = useHudPresentation()
  const resolvedOwner: PortalOwner = owner ?? presentationModeToRootId(mode)
  const [target, setTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    registerPortal(portalId, resolvedOwner)

    const resolve = () => {
      if (resolvedOwner === 'global') {
        setTarget(getGlobalOverlayTarget())
      } else {
        setTarget(getModePortalTarget(resolvedOwner as ModeRootId))
      }
    }

    resolve()
    const observer = new MutationObserver(resolve)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      unregisterPortal(portalId)
    }
  }, [portalId, resolvedOwner])

  if (!target) return null
  return createPortal(children, target)
}

export default ModePortal
