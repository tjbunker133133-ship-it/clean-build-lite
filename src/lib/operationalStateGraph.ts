/**
 * Operational State Graph (OSG) — canonical runtime model for map behavior.
 *
 * Single source of truth for interaction, session, and runtime context.
 * mapInteractionController + missionController are graph adapters only.
 */

import type { Waypoint } from '../types'
import {
  applyWaypointArrivalConfirmation,
  migrateLegacyWaypointStatuses,
  restoreArchivedWaypoint,
  statusForNewWaypoint,
} from './waypointNavigation'
import { pushForensicTrace } from '../runtime/runtimeForensics'
import {
  clearOsgRouteStorage,
  loadOsgRouteWaypoints,
  saveOsgRouteWaypoints,
} from './operationalStateGraph/routePersistence'
import { clearMissionSessionStorage, loadMissionSession, saveMissionSession } from './missionController/persist'
import {
  DEFAULT_MISSION_SESSION,
  type EnterMissionInput,
  type MissionSession,
  type MissionStatus,
  type MissionWaypointRef,
  type UpdateMissionInput,
} from './missionController/types'
import {
  pointerOwnerForMode,
  validateModeTransition,
  type TransitionValidationResult,
} from './operationalStateGraph/transitions'
import type {
  InteractionSurface,
  InteractionToolVariant,
  MeasurementState,
  OperationalMode,
  OperationalStateGraph,
  OperationalTransition,
  PointerOwner,
  RadialAnchor,
  MeasureUnits,
  MapSurfacePulse,
} from './operationalStateGraph/types'

export type {
  InteractionSurface,
  InteractionToolVariant,
  MeasurementState,
  OperationalMode,
  OperationalStateGraph,
  OperationalTransition,
  PointerOwner,
  RadialAnchor,
  MeasureUnits,
  MapSurfacePulse,
} from './operationalStateGraph/types'
export { TRANSITION_MATRIX, validateModeTransition } from './operationalStateGraph/transitions'

// ─── State ─────────────────────────────────────────────────────────────────────

const listeners = new Set<() => void>()

function toWaypointRefs(waypoints: Waypoint[]): MissionWaypointRef[] {
  return waypoints
    .filter((w) => w.status !== 'archived')
    .map((w) => ({
      id: w.id,
      lat: w.lat,
      lng: w.lng,
      label: w.label,
      type: w.type,
    }))
}

function syncRouteWaypointBindings(waypoints: Waypoint[]): void {
  const migrated = migrateLegacyWaypointStatuses(waypoints)
  graph.session.routeWaypoints = migrated.map((w) => ({ ...w }))
  graph.session.waypoints = toWaypointRefs(migrated)
  saveOsgRouteWaypoints(graph.session.routeWaypoints)
}

function buildInitialGraph(): OperationalStateGraph {
  const persisted = loadMissionSession()
  const routeWaypoints = loadOsgRouteWaypoints()
  const missionActive = persisted.status === 'active' || persisted.status === 'paused'
  return {
    mode: missionActive ? 'mission' : 'idle',
    interaction: {
      pointerOwner: missionActive ? 'mission' : 'map',
      activeTool: missionActive ? 'mission' : 'idle',
      toolVariant: null,
      locked: missionActive,
      surface: 'none',
      preRadialTool: 'idle',
      preRadialVariant: null,
      radialActive: false,
      radialAnchor: null,
      pendingWaypointType: 'pin',
      mapSurfacePulse: null,
    },
    session: {
      mission: { ...persisted },
      routeId: persisted.activeRouteId,
      routeName: persisted.mapSession?.routeName ?? 'Field route',
      routeWaypoints: routeWaypoints.map((w) => ({ ...w })),
      waypoints: toWaypointRefs(routeWaypoints),
      activeMeasurement: null,
    },
    runtime: {
      gps: { ...persisted.gps },
      environment: { ...persisted.environment, activeOverlays: [...persisted.environment.activeOverlays] },
      mapSession: persisted.mapSession ? { ...persisted.mapSession } : null,
      measureUnits: 'imperial',
    },
    control: {
      lastTransition: Date.now(),
      transitionSource: 'boot',
      lastRejection: null,
      lastTransitionFrom: null,
      lastTransitionPath: [],
      conflictResolutionMode: 'strict',
    },
  }
}

let graph: OperationalStateGraph = buildInitialGraph()

function generateMeasurementId(): string {
  return `msr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function buildMeasurement(
  surface: InteractionSurface,
  points: Array<{ lat: number; lng: number }> = [],
  existing: MeasurementState | null = null,
): MeasurementState {
  const now = Date.now()
  return {
    id: existing?.id ?? generateMeasurementId(),
    points: [...points],
    createdAt: existing?.createdAt ?? now,
    lastUpdated: now,
    modeContext: 'measure',
    surface,
  }
}

function trace(event: string, detail?: Record<string, unknown>): void {
  pushForensicTrace('command', `osg_${event}`, {
    mode: graph.mode,
    pointerOwner: graph.interaction.pointerOwner,
    activeTool: graph.interaction.activeTool,
    missionStatus: graph.session.mission.status,
    routeId: graph.session.routeId,
    measurePoints: graph.session.activeMeasurement?.points.length ?? 0,
    ...detail,
  })
}

function cloneGraph(): OperationalStateGraph {
  const m = graph.session.mission
  return {
    ...graph,
    interaction: { ...graph.interaction },
    session: {
      mission: {
        ...m,
        waypoints: [...m.waypoints],
        activeWaypointIds: [...m.activeWaypointIds],
        gps: { ...m.gps },
        environment: { ...m.environment, activeOverlays: [...m.environment.activeOverlays] },
        mapSession: m.mapSession ? { ...m.mapSession } : null,
      },
      routeId: graph.session.routeId,
      routeName: graph.session.routeName,
      routeWaypoints: graph.session.routeWaypoints.map((w) => ({ ...w })),
      waypoints: [...graph.session.waypoints],
      activeMeasurement: graph.session.activeMeasurement
        ? { ...graph.session.activeMeasurement, points: [...graph.session.activeMeasurement.points] }
        : null,
    },
    runtime: {
      gps: { ...graph.runtime.gps },
      environment: { ...graph.runtime.environment, activeOverlays: [...graph.runtime.environment.activeOverlays] },
      mapSession: graph.runtime.mapSession ? { ...graph.runtime.mapSession } : null,
      measureUnits: graph.runtime.measureUnits,
    },
    control: { ...graph.control },
  }
}

function syncMissionPersistence(): void {
  graph.session.mission = {
    ...graph.session.mission,
    activeRouteId: graph.session.routeId,
    waypoints: [...graph.session.waypoints],
    gps: { ...graph.runtime.gps },
    environment: { ...graph.runtime.environment, activeOverlays: [...graph.runtime.environment.activeOverlays] },
    mapSession: graph.runtime.mapSession ? { ...graph.runtime.mapSession } : graph.session.mission.mapSession,
  }
  if (graph.session.mission.status === 'active' || graph.session.mission.status === 'paused') {
    saveMissionSession(graph.session.mission)
  }
}

function emit(source: string): void {
  graph.control.lastTransition = Date.now()
  graph.control.transitionSource = source
  syncMissionPersistence()
  publishDebugSurface()
  listeners.forEach((l) => l())
}

function pointerForMode(mode: OperationalMode, variant: InteractionToolVariant): PointerOwner {
  const owner = pointerOwnerForMode(mode, variant)
  return owner as PointerOwner
}

function missionSessionActive(): boolean {
  const s = graph.session.mission.status
  return s === 'active' || s === 'paused'
}

function validationContext() {
  return {
    measurementPointCount: graph.session.activeMeasurement?.points.length ?? 0,
    missionActive: missionSessionActive(),
  }
}

function cleanupLeavingMode(prev: OperationalMode, next: OperationalMode): void {
  if (prev === next) return
  // Measurement geometry persists across mode switches — cleared only on explicit exit or session reset.
  if (next === 'measure' || next === 'route') {
    graph.interaction.radialActive = false
  }
}

function applyStrictConflictResolution(next: OperationalTransition): OperationalTransition {
  const targetMode = next.mode ?? graph.mode
  if (targetMode === 'measure') {
    return {
      ...next,
      mode: 'measure',
      interaction: {
        ...next.interaction,
        activeTool: 'measure',
        toolVariant: null,
        locked: false,
        pointerOwner: 'measure',
      },
      session: {
        ...next.session,
        activeMeasurement:
          next.session?.activeMeasurement ??
          graph.session.activeMeasurement ??
          buildMeasurement(next.interaction?.surface ?? graph.interaction.surface),
      },
    }
  }
  if (targetMode === 'route') {
    return {
      ...next,
      mode: 'route',
      interaction: {
        ...next.interaction,
        activeTool: 'route',
        pointerOwner: 'route',
      },
    }
  }
  if (targetMode === 'mission') {
    return {
      ...next,
      mode: 'mission',
      interaction: {
        ...next.interaction,
        activeTool: 'mission',
        locked: true,
        pointerOwner: graph.interaction.radialActive ? 'radial' : 'mission',
      },
    }
  }
  if (targetMode === 'navigation') {
    return {
      ...next,
      mode: 'navigation',
      interaction: {
        ...next.interaction,
        activeTool: 'navigation',
        locked: false,
        pointerOwner: 'map',
      },
    }
  }
  if (targetMode === 'idle') {
    return {
      ...next,
      mode: 'idle',
      interaction: {
        ...next.interaction,
        activeTool: 'idle',
        locked: missionSessionActive(),
        pointerOwner: 'map',
      },
    }
  }
  if (targetMode === 'radial') {
    return {
      ...next,
      mode: 'radial',
      interaction: {
        ...next.interaction,
        activeTool: 'radial',
        pointerOwner: 'radial',
        radialActive: true,
      },
    }
  }
  return next
}

function applyTransitionPatch(resolved: OperationalTransition): void {
  if (resolved.mode) graph.mode = resolved.mode

  if (resolved.interaction) {
    graph.interaction = { ...graph.interaction, ...resolved.interaction }
    if (resolved.interaction.activeTool) {
      graph.interaction.pointerOwner = pointerForMode(
        graph.interaction.activeTool,
        graph.interaction.toolVariant,
      )
    }
  }

  if (resolved.session) {
    if (resolved.session.mission) {
      graph.session.mission = { ...graph.session.mission, ...resolved.session.mission }
    }
    if (resolved.session.routeId !== undefined) graph.session.routeId = resolved.session.routeId
    if (resolved.session.routeName !== undefined) graph.session.routeName = resolved.session.routeName
    if (resolved.session.routeWaypoints) {
      syncRouteWaypointBindings(resolved.session.routeWaypoints)
    } else if (resolved.session.waypoints) {
      graph.session.waypoints = [...resolved.session.waypoints]
    }
    if (resolved.session.activeMeasurement !== undefined) {
      graph.session.activeMeasurement = resolved.session.activeMeasurement
        ? { ...resolved.session.activeMeasurement, points: [...resolved.session.activeMeasurement.points] }
        : null
    }
  }

  if (resolved.runtime) {
    if (resolved.runtime.gps) graph.runtime.gps = { ...graph.runtime.gps, ...resolved.runtime.gps }
    if (resolved.runtime.environment) {
      graph.runtime.environment = {
        ...graph.runtime.environment,
        ...resolved.runtime.environment,
        activeOverlays: resolved.runtime.environment.activeOverlays ?? graph.runtime.environment.activeOverlays,
      }
    }
    if (resolved.runtime.mapSession !== undefined) {
      graph.runtime.mapSession = resolved.runtime.mapSession ? { ...resolved.runtime.mapSession } : null
    }
  }

  if (resolved.control) graph.control = { ...graph.control, ...resolved.control }
}

function applyIntermediateModeStep(step: OperationalMode, source: string): void {
  const prev = graph.mode
  cleanupLeavingMode(prev, step)
  const patch = applyStrictConflictResolution({ mode: step })
  applyTransitionPatch(patch)
  trace('transition_hop', { source, from: prev, to: step })
}

function restoreGraph(snapshot: OperationalStateGraph): void {
  graph = snapshot
}

/** Returns false when transition is rejected (fail-safe — no partial apply). */
export function transitionOperationalState(next: OperationalTransition, source: string): boolean {
  const stable = cloneGraph()
  const prevMode = graph.mode
  const targetMode = next.mode

  // Session/runtime patch only — no mode change
  if (targetMode === undefined || targetMode === prevMode) {
    const resolved = graph.control.conflictResolutionMode === 'strict'
      ? applyStrictConflictResolution(next)
      : next
    applyTransitionPatch(resolved)
    graph.control.lastRejection = null
    trace('transition_patch', { source, mode: graph.mode })
    emit(source)
    return true
  }

  // 1. VALIDATE
  const validation: TransitionValidationResult = validateModeTransition(
    prevMode,
    targetMode,
    validationContext(),
  )

  if (!validation.allowed) {
    graph.control.lastRejection = validation.reason ?? 'transition_denied'
    trace('transition_rejected', { source, from: prevMode, to: targetMode, reason: validation.reason })
    publishDebugSurface()
    return false
  }

  const path = validation.resolvedPath
  const hops = path.length > 1 ? path.slice(0, -1) : []
  const finalMode = path[path.length - 1]

  try {
    // 2. PRE-CLEANUP + intermediate hops
    for (const hop of hops) {
      applyIntermediateModeStep(hop, source)
    }

    if (hops.length > 0) {
      cleanupLeavingMode(graph.mode, finalMode)
    } else if (finalMode !== prevMode) {
      cleanupLeavingMode(prevMode, finalMode)
    }

    // 3. COMMIT + 4. POST-BIND
    const resolved = graph.control.conflictResolutionMode === 'strict'
      ? applyStrictConflictResolution({ ...next, mode: finalMode })
      : { ...next, mode: finalMode }
    applyTransitionPatch(resolved)

    // 5. NOTIFY
    graph.control.lastRejection = null
    graph.control.lastTransitionFrom = prevMode
    graph.control.lastTransitionPath = path
    trace('transition', {
      source,
      from: prevMode,
      to: graph.mode,
      path: path.join('→'),
      verdict: validation.verdict,
    })
    emit(source)
    return true
  } catch (err) {
    restoreGraph(stable)
    graph.control.lastRejection = `transition_failed:${String(err)}`
    trace('transition_reverted', { source, from: prevMode, to: targetMode })
    publishDebugSurface()
    return false
  }
}

export function canTransitionOperationalMode(to: OperationalMode) {
  return validateModeTransition(graph.mode, to, validationContext())
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function subscribeOperationalGraph(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getOperationalGraphSnapshot(): OperationalStateGraph {
  return cloneGraph()
}

export function publishDebugSurface(): void {
  if (typeof window === 'undefined') return
  const w = window as Window & {
    __OPERATIONAL_GRAPH__?: () => OperationalStateGraph & {
      canTransition: typeof canTransitionOperationalMode
    }
  }
  w.__OPERATIONAL_GRAPH__ = () => ({
    ...getOperationalGraphSnapshot(),
    canTransition: canTransitionOperationalMode,
  })
}

// ─── Interaction adapters (formerly mapInteractionController) ────────────────

export type MapInteractionMode = 'none' | 'measure' | 'route' | 'drop' | 'inspect' | 'radial'

export function osgEnterMeasure(surface: InteractionSurface, resetPoints = true): void {
  const existing = graph.session.activeMeasurement
  const points = resetPoints ? [] : (existing?.points ?? [])
  transitionOperationalState(
    {
      mode: 'measure',
      interaction: { surface, activeTool: 'measure', toolVariant: null, locked: false, pointerOwner: 'measure' },
      session: {
        activeMeasurement: buildMeasurement(surface, points, resetPoints ? null : existing),
      },
    },
    'enter_measure',
  )
}

export function osgExitMeasure(): void {
  if (graph.mode !== 'measure') return
  const restoreMission = missionSessionActive()
  const restoreRadial = graph.interaction.radialActive
  const restore: OperationalMode = restoreRadial ? 'radial' : restoreMission ? 'mission' : 'idle'
  transitionOperationalState(
    {
      mode: restore,
      interaction: {
        activeTool: restore,
        toolVariant: null,
        pointerOwner: restoreRadial ? 'radial' : restoreMission ? 'mission' : 'map',
        locked: restoreMission,
      },
      session: { activeMeasurement: null },
    },
    'exit_measure',
  )
}

/** Release measure pointer ownership after a completed two-point readout. Geometry stays in session. */
export function osgFinalizeMeasureInteraction(): void {
  if (graph.mode !== 'measure') return
  if ((graph.session.activeMeasurement?.points.length ?? 0) < 2) return
  if (missionSessionActive()) return
  transitionOperationalState(
    {
      mode: 'idle',
      interaction: {
        activeTool: 'idle',
        toolVariant: null,
        pointerOwner: 'map',
        locked: false,
      },
    },
    'measure_complete',
  )
}

export function osgEnterRouteMode(surface: InteractionSurface, variant: InteractionToolVariant = 'plan'): void {
  transitionOperationalState(
    {
      mode: 'route',
      interaction: { surface, activeTool: 'route', toolVariant: variant, pointerOwner: 'route', locked: false },
    },
    'enter_route',
  )
}

/** Begin field navigation — transitions OSG to navigation mode (Modern route sheet). */
export function osgEnterNavigation(surface: InteractionSurface = 'modern'): boolean {
  return transitionOperationalState(
    {
      mode: 'navigation',
      interaction: {
        surface,
        activeTool: 'navigation',
        toolVariant: null,
        pointerOwner: 'map',
        locked: false,
      },
    },
    'enter_navigation',
  )
}

export function osgEnterIdleInspect(surface: InteractionSurface): void {
  transitionOperationalState(
    {
      mode: 'idle',
      interaction: { surface, activeTool: 'idle', toolVariant: 'inspect', pointerOwner: 'map', locked: false },
    },
    'enter_inspect',
  )
}

export function osgClearInteraction(): void {
  const restoreMission = missionSessionActive()
  transitionOperationalState(
    {
      mode: restoreMission ? 'mission' : graph.interaction.radialActive ? 'radial' : 'idle',
      interaction: {
        activeTool: restoreMission ? 'mission' : graph.interaction.radialActive ? 'radial' : 'idle',
        toolVariant: null,
        pointerOwner: graph.interaction.radialActive ? 'radial' : restoreMission ? 'mission' : 'map',
        locked: restoreMission,
      },
    },
    'clear_interaction',
  )
}

export function osgSetRadialAnchor(anchor: RadialAnchor | null): void {
  transitionOperationalState(
    { interaction: { radialAnchor: anchor } },
    anchor ? 'radial_anchor_set' : 'radial_anchor_clear',
  )
}

export function osgGetRadialAnchor(): RadialAnchor | null {
  return graph.interaction.radialAnchor
    ? { ...graph.interaction.radialAnchor }
    : null
}

export function osgSetPendingWaypointType(type: string): void {
  transitionOperationalState(
    { interaction: { pendingWaypointType: type } },
    'set_pending_waypoint_type',
  )
}

/** Atomically enter drop mode and arm pending type (panel / workspace arming). */
export function osgArmWaypointDrop(surface: InteractionSurface, type: string): void {
  const pending = type && type !== 'default' ? type : 'pin'
  transitionOperationalState(
    {
      mode: 'route',
      interaction: {
        surface,
        activeTool: 'route',
        toolVariant: 'drop',
        pointerOwner: 'route',
        locked: false,
        pendingWaypointType: pending,
      },
    },
    'arm_waypoint_drop',
  )
}

export function osgGetPendingWaypointType(): string {
  return graph.interaction.pendingWaypointType
}

export function osgSetRouteName(routeName: string): void {
  transitionOperationalState(
    { session: { routeName: routeName.trim() || 'Field route' } },
    'set_route_name',
  )
}

export function osgGetRouteWaypoints(): ReadonlyArray<Waypoint> {
  return graph.session.routeWaypoints
}

export function osgSetRouteWaypoints(waypoints: Waypoint[]): void {
  syncRouteWaypointBindings(waypoints)
  transitionOperationalState(
    {
      session: {
        routeWaypoints: graph.session.routeWaypoints,
        waypoints: graph.session.waypoints,
      },
    },
    'set_route_waypoints',
  )
}

export function osgAddRouteWaypoint(wp: Waypoint): void {
  const navStatus = wp.status ?? statusForNewWaypoint(graph.session.routeWaypoints)
  const withStatus = { ...wp, status: navStatus }
  syncRouteWaypointBindings([...graph.session.routeWaypoints, withStatus])
  transitionOperationalState(
    {
      session: {
        routeWaypoints: graph.session.routeWaypoints,
        waypoints: graph.session.waypoints,
      },
    },
    'add_route_waypoint',
  )
}

export function osgUpdateRouteWaypoint(id: string, patch: Partial<Waypoint>): void {
  const next = graph.session.routeWaypoints.map((w) =>
    w.id === id ? { ...w, ...patch } : w,
  )
  syncRouteWaypointBindings(next)
  transitionOperationalState(
    {
      session: {
        routeWaypoints: graph.session.routeWaypoints,
        waypoints: graph.session.waypoints,
      },
    },
    'update_route_waypoint',
  )
}

export function osgRemoveRouteWaypoint(id: string): void {
  syncRouteWaypointBindings(graph.session.routeWaypoints.filter((w) => w.id !== id))
  transitionOperationalState(
    {
      session: {
        routeWaypoints: graph.session.routeWaypoints,
        waypoints: graph.session.waypoints,
      },
    },
    'remove_route_waypoint',
  )
}

export function osgConfirmWaypointArrival(): void {
  syncRouteWaypointBindings(applyWaypointArrivalConfirmation(graph.session.routeWaypoints))
  transitionOperationalState(
    {
      session: {
        routeWaypoints: graph.session.routeWaypoints,
        waypoints: graph.session.waypoints,
      },
    },
    'confirm_waypoint_arrival',
  )
}

export function osgRestoreArchivedRouteWaypoint(id: string): void {
  syncRouteWaypointBindings(restoreArchivedWaypoint(graph.session.routeWaypoints, id))
  transitionOperationalState(
    {
      session: {
        routeWaypoints: graph.session.routeWaypoints,
        waypoints: graph.session.waypoints,
      },
    },
    'restore_archived_waypoint',
  )
}

/** @deprecated Use osgGetRouteWaypoints — mission ref projection. */
export function osgSyncSessionWaypoints(waypoints: MissionWaypointRef[]): void {
  const full: Waypoint[] = waypoints.map((w) => ({
    id: w.id,
    lat: w.lat,
    lng: w.lng,
    label: w.label ?? w.type,
    type: (w.type as Waypoint['type']) ?? 'pin',
    createdAt: Date.now(),
    status: 'active',
  }))
  osgSetRouteWaypoints(full)
}

export function osgGetSessionWaypoints(): ReadonlyArray<MissionWaypointRef> {
  return graph.session.waypoints
}

export function osgSetRadialActive(active: boolean): void {
  if (active) {
    if (!graph.interaction.radialActive) {
      graph.interaction.preRadialTool = graph.interaction.activeTool
      graph.interaction.preRadialVariant = graph.interaction.toolVariant
    }
    transitionOperationalState(
      {
        mode: 'radial',
        interaction: {
          radialActive: true,
          activeTool: 'radial',
          pointerOwner: 'radial',
        },
      },
      'enter_radial',
    )
    return
  }

  const restoreTool = graph.interaction.preRadialTool
  const restoreVariant = graph.interaction.preRadialVariant
  transitionOperationalState(
    {
      mode: restoreTool,
      interaction: {
        radialActive: false,
        activeTool: restoreTool,
        toolVariant: restoreVariant,
        pointerOwner: pointerForMode(restoreTool, restoreVariant),
        preRadialTool: 'idle',
        preRadialVariant: null,
        radialAnchor: null,
      },
    },
    'exit_radial',
  )
}

export function osgAddMeasurePoint(lat: number, lng: number): boolean {
  if (graph.mode !== 'measure' || graph.interaction.pointerOwner !== 'measure') {
    trace('measure_rejected', { lat, lng })
    return false
  }
  const existing = graph.session.activeMeasurement
  const surface = existing?.surface ?? graph.interaction.surface
  const pts = existing?.points ?? []
  const nextPts = pts.length >= 2 ? [{ lat, lng }] : [...pts, { lat, lng }]
  transitionOperationalState(
    {
      session: {
        activeMeasurement: buildMeasurement(surface, nextPts, existing),
      },
    },
    'measure_point',
  )
  if (nextPts.length >= 2) {
    osgFinalizeMeasureInteraction()
  }
  return true
}

export function osgRouteMapClick(lat: number, lng: number): boolean {
  if (graph.mode !== 'measure') return false
  return osgAddMeasurePoint(lat, lng)
}

export function osgGetInteractionSurface(): InteractionSurface {
  return graph.interaction.surface
}

export function osgGetInteractionMode(): MapInteractionMode {
  if (graph.interaction.radialActive || graph.mode === 'radial') return 'radial'
  if (graph.mode === 'measure') return 'measure'
  if (graph.mode === 'route') {
    return graph.interaction.toolVariant === 'drop' ? 'drop' : 'route'
  }
  if (graph.interaction.toolVariant === 'inspect') return 'inspect'
  return 'none'
}

export function osgGetPointerOwner(): MapInteractionMode | 'mission' {
  const p = graph.interaction.pointerOwner
  if (p === 'radial') return 'radial'
  if (p === 'measure') return 'measure'
  if (p === 'route') return graph.interaction.toolVariant === 'drop' ? 'drop' : 'route'
  if (p === 'mission') return 'mission' as MapInteractionMode
  return 'none'
}

export function osgGetMeasurePoints(): ReadonlyArray<{ lat: number; lng: number }> {
  return graph.session.activeMeasurement?.points ?? []
}

export function osgShouldBlockWaypointPlacement(): boolean {
  // Inspect is trail-read mode, not a modal lock — pending type gates placement.
  return graph.mode === 'measure' || graph.mode === 'radial' || graph.interaction.radialActive
}

export function osgShouldBlockTrailInspect(): boolean {
  return graph.mode === 'measure' || graph.mode === 'radial' || graph.interaction.radialActive
}

export function osgShouldBlockLongPress(): boolean {
  return graph.mode === 'measure' || graph.interaction.toolVariant === 'inspect' || graph.interaction.radialActive
}

export function osgSyncBalancedTool(tool: 'inspect' | 'route' | 'waypoint' | 'measure' | 'none'): void {
  switch (tool) {
    case 'measure': osgEnterMeasure('balanced'); break
    case 'route': osgEnterRouteMode('balanced', 'plan'); break
    // Drop variant keeps waypoint placement while allowing long-press radial (inspect variant blocks it).
    case 'waypoint': osgEnterRouteMode('balanced', 'drop'); break
    case 'inspect': osgEnterIdleInspect('balanced'); break
    default: osgClearInteraction(); break
  }
}

export function osgSyncModernMeasure(enabled: boolean): void {
  if (enabled) osgEnterMeasure('modern')
  else if (graph.mode === 'measure' && graph.interaction.surface === 'modern') osgExitMeasure()
}

export function osgClearMeasurePoints(): void {
  if (!graph.session.activeMeasurement) return
  const surface = graph.session.activeMeasurement.surface ?? graph.interaction.surface
  transitionOperationalState(
    {
      session: {
        activeMeasurement: buildMeasurement(surface, [], graph.session.activeMeasurement),
      },
    },
    'measure_clear',
  )
}

/** Remove completed or abandoned measurement geometry from session. */
export function osgClearActiveMeasurement(): void {
  if (!graph.session.activeMeasurement) return
  transitionOperationalState(
    { session: { activeMeasurement: null } },
    'measure_dismiss',
  )
}

export function osgUpdateMeasurePoint(index: number, lat: number, lng: number): boolean {
  const existing = graph.session.activeMeasurement
  if (!existing || index < 0 || index >= existing.points.length) return false
  const nextPts = existing.points.map((p, i) => (i === index ? { lat, lng } : p))
  transitionOperationalState(
    {
      session: {
        activeMeasurement: buildMeasurement(existing.surface, nextPts, existing),
      },
    },
    'measure_drag',
  )
  return true
}

// ─── Mission adapters (formerly missionController) ─────────────────────────────

function generateMissionId(): string {
  return `msn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function bindRoute(missionId: string, waypoints: MissionWaypointRef[]) {
  return {
    routeId: `${missionId}_route`,
    activeWaypointIds: waypoints.map((w) => w.id),
  }
}

export function osgEnterMission(input: EnterMissionInput): void {
  const m = graph.session.mission
  if (
    (m.status === 'active' || m.status === 'paused') &&
    input.kind === 'team' &&
    input.teamMissionId &&
    m.teamMissionId === input.teamMissionId
  ) {
    osgUpdateMission({
      missionName: input.missionName,
      waypoints: input.waypoints,
      mapSession: input.mapSession ?? undefined,
      teamMissionId: input.teamMissionId,
    })
    return
  }
  if ((m.status === 'active' || m.status === 'paused') && input.kind === 'solo' && m.kind === 'solo') {
    return
  }

  const missionId = input.missionId ?? generateMissionId()
  const waypoints = input.waypoints ?? graph.session.waypoints
  const route = bindRoute(missionId, waypoints)
  const now = Date.now()

  transitionOperationalState(
    {
      mode: 'mission',
      interaction: { activeTool: 'mission', locked: true, pointerOwner: graph.interaction.radialActive ? 'radial' : 'mission' },
      session: {
        mission: {
          missionId,
          missionName: input.missionName.trim() || 'Field mission',
          status: 'active',
          kind: input.kind,
          startTime: now,
          endTime: null,
          pausedAt: null,
          teamMissionId: input.teamMissionId ?? null,
          waypoints,
          activeWaypointIds: route.activeWaypointIds,
          activeRouteId: route.routeId,
          mapSession: input.mapSession ?? graph.runtime.mapSession,
        },
        routeId: route.routeId,
        waypoints,
      },
      runtime: input.mapSession ? { mapSession: input.mapSession } : undefined,
    },
    'enter_mission',
  )
}

let lastMissionUpdateFingerprint = ''

export function osgUpdateMission(patch: UpdateMissionInput): void {
  const status = graph.session.mission.status
  if (status !== 'active' && status !== 'paused') return

  const nextWaypoints = patch.waypoints ?? graph.session.waypoints
  const routeBinding =
    patch.waypoints && graph.session.mission.missionId
      ? bindRoute(graph.session.mission.missionId, nextWaypoints)
      : {
          routeId: patch.activeRouteId ?? graph.session.routeId,
          activeWaypointIds: patch.activeWaypointIds ?? graph.session.mission.activeWaypointIds,
        }

  const fingerprint = JSON.stringify({
    waypoints: nextWaypoints,
    routeId: routeBinding.routeId,
    activeWaypointIds: routeBinding.activeWaypointIds,
    gps: patch.gps ?? null,
    environment: patch.environment ?? null,
    mapSession: patch.mapSession ?? null,
    activeRouteId: patch.activeRouteId ?? null,
  })
  if (fingerprint === lastMissionUpdateFingerprint) return
  lastMissionUpdateFingerprint = fingerprint

  transitionOperationalState(
    {
      session: {
        mission: {
          ...patch,
          waypoints: nextWaypoints,
          activeRouteId: routeBinding.routeId,
          activeWaypointIds: routeBinding.activeWaypointIds,
          gps: patch.gps ? { ...graph.runtime.gps, ...patch.gps } : undefined,
          environment: patch.environment
            ? { ...graph.runtime.environment, ...patch.environment }
            : undefined,
          mapSession: patch.mapSession ?? undefined,
        },
        routeId: routeBinding.routeId,
        waypoints: nextWaypoints,
      },
      runtime: {
        gps: patch.gps ? { ...graph.runtime.gps, ...patch.gps } : undefined,
        environment: patch.environment ? { ...graph.runtime.environment, ...patch.environment } : undefined,
        mapSession: patch.mapSession ?? undefined,
      },
    },
    'update_mission',
  )
}

export function osgPauseMission(): void {
  if (graph.session.mission.status !== 'active') return
  transitionOperationalState(
    { session: { mission: { status: 'paused', pausedAt: Date.now() } }, mode: 'mission' },
    'pause_mission',
  )
}

export function osgResumeMission(): void {
  if (graph.session.mission.status !== 'paused') return
  transitionOperationalState(
    { session: { mission: { status: 'active', pausedAt: null } }, mode: 'mission' },
    'resume_mission',
  )
}

export function osgExitMission(reason = 'explicit'): void {
  if (graph.session.mission.status === 'inactive') return
  lastMissionUpdateFingerprint = ''
  trace('exit_mission', { reason })
  graph.session.mission = { ...DEFAULT_MISSION_SESSION }
  graph.session.routeId = null
  graph.session.waypoints = []
  graph.session.routeWaypoints = []
  graph.session.activeMeasurement = null
  clearMissionSessionStorage()
  clearOsgRouteStorage()
  transitionOperationalState(
    {
      mode: 'idle',
      interaction: { activeTool: 'idle', toolVariant: null, locked: false, pointerOwner: 'map', radialActive: false },
      session: {
        mission: { ...DEFAULT_MISSION_SESSION },
        routeId: null,
        routeWaypoints: [],
        waypoints: [],
        activeMeasurement: null,
      },
    },
    `exit_mission:${reason}`,
  )
}

export function osgGetMissionSnapshot(): MissionSession {
  return cloneGraph().session.mission
}

export function osgIsMissionActive(): boolean {
  const s = graph.session.mission.status
  return s === 'active' || s === 'paused'
}

export function osgGetMissionStatus(): MissionStatus {
  return graph.session.mission.status
}

export function osgGetMissionDurationMs(now = Date.now()): number | null {
  const m = graph.session.mission
  if (!m.startTime) return null
  const end = m.status === 'paused' && m.pausedAt ? m.pausedAt : now
  return Math.max(0, end - m.startTime)
}

export function osgFormatMissionDuration(now = Date.now()): string {
  const ms = osgGetMissionDurationMs(now)
  if (ms == null) return '—'
  const totalSec = Math.floor(ms / 1000)
  const hours = Math.floor(totalSec / 3600)
  const minutes = Math.floor((totalSec % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes} min`
}

export function osgGetMeasureUnits(): MeasureUnits {
  return graph.runtime.measureUnits
}

export function osgSetMeasureUnits(units: MeasureUnits): void {
  if (graph.runtime.measureUnits === units) return
  graph.runtime.measureUnits = units
  emit('measure_units')
}

export function osgRecordMapSurfacePulse(lat: number, lng: number): void {
  graph.interaction.mapSurfacePulse = { lat, lng, at: Date.now() }
  emit('map_surface_pulse')
  if (typeof window !== 'undefined') {
    window.setTimeout(() => {
      const pulse = graph.interaction.mapSurfacePulse
      if (pulse && pulse.lat === lat && pulse.lng === lng && Date.now() - pulse.at >= 900) {
        graph.interaction.mapSurfacePulse = null
        emit('map_surface_pulse_clear')
      }
    }, 950)
  }
}

export function osgGetMapSurfacePulse(): MapSurfacePulse | null {
  const pulse = graph.interaction.mapSurfacePulse
  if (!pulse) return null
  if (Date.now() - pulse.at > 1200) {
    graph.interaction.mapSurfacePulse = null
    return null
  }
  return pulse
}

export function __resetOperationalStateGraphForTests(): void {
  lastMissionUpdateFingerprint = ''
  clearOsgRouteStorage()
  graph = {
    mode: 'idle',
    interaction: {
      pointerOwner: 'map',
      activeTool: 'idle',
      toolVariant: null,
      locked: false,
      surface: 'none',
      preRadialTool: 'idle',
      preRadialVariant: null,
      radialActive: false,
      radialAnchor: null,
      pendingWaypointType: 'pin',
      mapSurfacePulse: null,
    },
    session: {
      mission: { ...DEFAULT_MISSION_SESSION },
      routeId: null,
      routeName: 'Field route',
      routeWaypoints: [],
      waypoints: [],
      activeMeasurement: null,
    },
    runtime: {
      gps: { ...DEFAULT_MISSION_SESSION.gps },
      environment: { ...DEFAULT_MISSION_SESSION.environment, activeOverlays: [] },
      mapSession: null,
      measureUnits: 'imperial',
    },
    control: {
      lastTransition: Date.now(),
      transitionSource: 'test_reset',
      lastRejection: null,
      lastTransitionFrom: null,
      lastTransitionPath: [],
      conflictResolutionMode: 'strict',
    },
  }
  clearMissionSessionStorage()
}

// Boot publish
publishDebugSurface()
