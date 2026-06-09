import { beforeEach, describe, expect, it } from 'vitest'
import {
  __resetMissionControllerForTests,
  enterMission,
  exitMission,
  formatMissionDuration,
  getMissionSnapshot,
  isMissionSessionActive,
  pauseMission,
  resumeMission,
  updateMission,
} from './missionController'

describe('missionController', () => {
  beforeEach(() => {
    __resetMissionControllerForTests()
  })

  it('getMissionSnapshot returns stable reference between calls', () => {
    enterMission({ missionName: 'Stable', kind: 'solo' })
    expect(getMissionSnapshot()).toBe(getMissionSnapshot())
  })

  it('enters mission with route binding and persistence fields', () => {
    enterMission({
      missionName: 'Alpha patrol',
      kind: 'solo',
      waypoints: [{ id: 'w1', lat: 40, lng: -105, type: 'pin' }],
      mapSession: { presentationMode: 'immersive', basemap: 'satellite', routeName: 'Route A' },
    })
    const snap = getMissionSnapshot()
    expect(snap.status).toBe('active')
    expect(snap.missionName).toBe('Alpha patrol')
    expect(snap.activeRouteId).toMatch(/^msn_/)
    expect(snap.activeWaypointIds).toEqual(['w1'])
    expect(isMissionSessionActive()).toBe(true)
  })

  it('updates telemetry without destroying session', () => {
    enterMission({ missionName: 'Bravo', kind: 'solo' })
    updateMission({
      gps: { lat: 41.1, lng: -106.2, accuracy: 8, updatedAt: Date.now() },
      environment: { online: false, activeOverlays: ['relief_usgs'], terrainOverlayEnabled: true, weatherAvailable: false },
    })
    const snap = getMissionSnapshot()
    expect(snap.gps.lat).toBe(41.1)
    expect(snap.environment.online).toBe(false)
    expect(snap.environment.activeOverlays).toContain('relief_usgs')
  })

  it('pause and resume preserve bindings', () => {
    enterMission({
      missionName: 'Charlie',
      kind: 'team',
      teamMissionId: 'team-1',
      waypoints: [{ id: 'w1', lat: 1, lng: 2, type: 'start' }],
    })
    pauseMission()
    expect(getMissionSnapshot().status).toBe('paused')
    resumeMission()
    const snap = getMissionSnapshot()
    expect(snap.status).toBe('active')
    expect(snap.teamMissionId).toBe('team-1')
    expect(snap.waypoints).toHaveLength(1)
  })

  it('exit clears active session', () => {
    enterMission({ missionName: 'Delta', kind: 'solo' })
    exitMission('test')
    const snap = getMissionSnapshot()
    expect(snap.status).toBe('inactive')
    expect(isMissionSessionActive()).toBe(false)
  })

  it('formats mission duration', () => {
    enterMission({ missionName: 'Echo', kind: 'solo' })
    const snap = getMissionSnapshot()
    expect(formatMissionDuration((snap.startTime ?? 0) + 125_000)).toBe('2 min')
  })
})
