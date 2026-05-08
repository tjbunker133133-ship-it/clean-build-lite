/** UX constants for waypoint placement & arrival (interaction only; no geometry math). */

/** Hold duration before a touch release commits a raw drop without the two-step bar. */
export const WAYPOINT_LONG_PRESS_MS = 520

/** Cancel long-press if the finger moves farther than this (screen px) from touchstart. */
export const WAYPOINT_LONG_PRESS_MOVE_PX = 14

/** Great-circle radius: GPS fix within this distance of a pin counts as “arrived”. */
export const WAYPOINT_ARRIVAL_RADIUS_M = 90
