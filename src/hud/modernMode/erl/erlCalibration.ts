/**
 * Perceptual calibration — phase-specific intensity multipliers.
 * Start quiet; raise only when field tests confirm "alive" not "alert."
 */

/** Global scale applied to all ERL compositor outputs. */
export const ERL_INTENSITY_MUL = 0.35

export const ERL_PHASE_CALIBRATION = {
  /** Phase 1 — trail emergence (opacity boost cap) */
  trailEmergence: 0.38,
  /** Phase 2 — bearing-relative atmosphere */
  forwardWeather: 0.14,
  forwardHazard: 0.12,
  rearClarity: 0.1,
  /** Phase 3 — aggregate field pressure */
  fieldPressure: 0.11,
  /** Phase 4 — temporal mood (ambient texture, not alert) */
  temporalMood: 0.09,
  /** Phase 5 — forward path legibility */
  navCoherence: 0.08,
  /** Phase 1 proximity signals */
  waypointCalm: 0.07,
  campWarmth: 0.09,
  hazardTension: 0.1,
} as const

/** Rest detection radii — intentional dwell suppresses temporal mood. */
export const REST_AT_WAYPOINT_M = 80
export const REST_AT_CAMP_M = 150
