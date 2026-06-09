/**
 * Balanced Layer Design Tokens
 * =============================
 *
 * Shared visual design system for the Balanced Layer.
 *
 * Principles:
 * - Restrained glassmorphism (not overdone)
 * - Clear visual hierarchy
 * - Touch-friendly (44px minimum targets)
 * - Map-first (panels support, don't compete)
 * - Calm, friendly, non-operator aesthetic
 */

// ═══════════════════════════════════════════════════════════════════════════════
// COLOR SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

export const colors = {
  // Backgrounds (subtle, letting map show through)
  bg: {
    panel: 'rgba(28, 28, 30, 0.82)',
    card: 'rgba(44, 44, 46, 0.72)',
    hover: 'rgba(58, 58, 60, 0.6)',
    active: 'rgba(72, 72, 74, 0.5)',
    input: 'rgba(0, 0, 0, 0.32)',
  },

  // Borders (subtle definition)
  border: {
    default: 'rgba(120, 120, 128, 0.22)',
    hover: 'rgba(120, 120, 128, 0.35)',
    active: 'rgba(10, 132, 255, 0.5)',
    danger: 'rgba(255, 69, 58, 0.4)',
  },

  // Text (careful contrast for readability)
  text: {
    primary: 'rgba(255, 255, 255, 0.92)',
    secondary: 'rgba(255, 255, 255, 0.65)',
    tertiary: 'rgba(255, 255, 255, 0.42)',
    disabled: 'rgba(255, 255, 255, 0.25)',
  },

  // Accents (iOS-style system colors, restrained)
  accent: {
    primary: '#0a84ff',      // iOS blue
    success: '#30d158',      // iOS green
    warning: '#ff9f0a',      // iOS orange
    danger: '#ff453a',       // iOS red
    purple: '#bf5af2',       // iOS purple
    teal: '#64d2ff',         // iOS cyan
  },

  // Map-centric status colors
  status: {
    online: '#30d158',
    offline: '#ff9f0a',
    error: '#ff453a',
    syncing: '#0a84ff',
  },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// SPACING SYSTEM (8px grid, touch-friendly)
// ═══════════════════════════════════════════════════════════════════════════════

export const spacing = {
  // Base units
  xs: 4,    // 4px - tight internal spacing
  sm: 8,    // 8px - element gaps
  md: 12,   // 12px - component padding
  lg: 16,   // 16px - section spacing
  xl: 20,   // 20px - panel margins
  xxl: 24,  // 24px - major separations

  // Touch targets (minimum 44px for accessibility)
  touch: {
    min: 44,
    comfortable: 48,
    large: 56,
  },

  // Panel sizing
  panel: {
    width: {
      sm: 280,   // Compact (mobile)
      md: 320,   // Standard
      lg: 380,   // Wide (desktop)
    },
    maxHeight: {
      sm: 320,   // Mobile
      md: 420,   // Standard
      lg: 520,   // Desktop
    },
  },

  // Safe areas
  safe: {
    top: 56,      // Below top bar
    workspaceBarBottom: 136, // Below WORKSPACE quick-actions column
    bottom: 88,   // Above bottom controls
    left: 16,
    right: 16,
  },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// TYPOGRAPHY (System font stack, clear hierarchy)
// ═══════════════════════════════════════════════════════════════════════════════

export const typography = {
  // Font stack
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif',

  // Sizes (in pixels)
  size: {
    xs: 11,    // Micro labels, badges
    sm: 12,    // Secondary labels, captions
    base: 13,  // Body text, inputs
    md: 14,    // Emphasized body
    lg: 15,    // Section headers
    xl: 16,    // Panel titles
    xxl: 18,   // Major headings
  },

  // Weights
  weight: {
    regular: 400,
    medium: 500,
    semibold: 600,
  },

  // Letter spacing
  letterSpacing: {
    tight: '-0.01em',
    normal: '0',
    wide: '0.03em',
    label: '0.04em',  // For uppercase labels
  },

  // Line heights
  lineHeight: {
    tight: 1.2,
    normal: 1.4,
    relaxed: 1.6,
  },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// SHADOWS & EFFECTS (Restrained, map-friendly)
// ═══════════════════════════════════════════════════════════════════════════════

export const effects = {
  // Backdrop blur (glassmorphism)
  blur: {
    sm: 'blur(12px)',
    md: 'blur(18px)',
    lg: 'blur(24px)',
  },

  // Shadows (subtle depth)
  shadow: {
    sm: '0 2px 8px rgba(0, 0, 0, 0.24)',
    md: '0 4px 16px rgba(0, 0, 0, 0.28)',
    lg: '0 8px 32px rgba(0, 0, 0, 0.32)',
    xl: '0 16px 48px rgba(0, 0, 0, 0.36)',
  },

  // Border radius
  radius: {
    sm: 6,
    md: 10,
    lg: 12,
    xl: 16,
    full: 9999,
  },

  // Transitions (quick but smooth)
  transition: {
    fast: 'all 120ms ease-out',
    normal: 'all 180ms ease-out',
    slow: 'all 250ms ease-out',
  },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// WAYPOINT TYPE STYLING (Consistent with map markers)
// ═══════════════════════════════════════════════════════════════════════════════

export const waypointTypes = {
  start:    { icon: '🚩', color: '#30d158', label: 'Start' },
  water:    { icon: '💧', color: '#0a84ff', label: 'Water' },
  camp:     { icon: '⛺', color: '#64d2ff', label: 'Camp' },
  rest:     { icon: '☕', color: '#ff9f0a', label: 'Rest' },
  poi:      { icon: '🔍', color: '#bf5af2', label: 'POI' },
  pin:      { icon: '📍', color: '#ff453a', label: 'Pin' },
  finish:   { icon: '🏁', color: '#ff375f', label: 'Finish' },
} as const

export type WaypointTypeKey = keyof typeof waypointTypes

// ═══════════════════════════════════════════════════════════════════════════════
// Z-INDEX LAYERING
// ═══════════════════════════════════════════════════════════════════════════════

export const zIndex = {
  map: 0,           // Base map
  mapOverlays: 10,  // Route lines, corridor
  markers: 20,      // Waypoint markers
  panels: 16000,    // Side panels — above radial menu backdrop (15000)
  quickActions: 16100,// Top action bar
  floatingTools: 16200,// Map tools, active indicators
  modals: 16300,    // Sheets, dialogs within balanced shell
  alerts: 16400,    // Emergency overlays within balanced shell
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL POSITIONING (Responsive, map-dominant)
// ═══════════════════════════════════════════════════════════════════════════════

export const panelPosition = {
  // Desktop: panels float at sides
  desktop: {
    left: { top: 136, left: 16, bottom: 24 },
    right: { top: 136, right: 16, bottom: 24 },
    bottom: { left: '50%', bottom: 16, transform: 'translateX(-50%)' },
  },

  // Mobile: panels stack, don't obscure map center
  mobile: {
    // Left panels become bottom sheets
    left: { left: 8, right: 8, bottom: 80, maxHeight: 280 },
    // Right panels become bottom sheets
    right: { left: 8, right: 8, bottom: 80, maxHeight: 280 },
    // Bottom strip stays compact
    bottom: { left: 8, right: 8, bottom: 16 },
  },

  // Map-safe zones (panels must stay outside)
  safeZone: {
    top: 64,      // Top bar height
    bottom: 72,   // Bottom controls
    left: 8,
    right: 8,
  },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// INTERACTION STATES (Consistent affordances)
// ═══════════════════════════════════════════════════════════════════════════════

export const interaction = {
  // Button states
  button: {
    default: {
      background: 'transparent',
      border: '1px solid transparent',
    },
    hover: {
      background: 'rgba(120, 120, 128, 0.15)',
    },
    active: {
      background: 'rgba(10, 132, 255, 0.15)',
      borderColor: 'rgba(10, 132, 255, 0.4)',
    },
    disabled: {
      opacity: 0.4,
      cursor: 'not-allowed',
    },
  },

  // Input states
  input: {
    default: {
      background: 'rgba(0, 0, 0, 0.32)',
      border: '1px solid rgba(120, 120, 128, 0.22)',
    },
    focus: {
      borderColor: 'rgba(10, 132, 255, 0.6)',
    },
    error: {
      borderColor: 'rgba(255, 69, 58, 0.6)',
    },
  },

  // Tool activation
  tool: {
    inactive: {
      background: 'transparent',
      color: colors.text.secondary,
    },
    active: {
      background: 'rgba(10, 132, 255, 0.18)',
      color: colors.accent.primary,
      border: '1.5px solid rgba(10, 132, 255, 0.5)',
    },
  },
} as const

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT CONVENIENCE OBJECT
// ═══════════════════════════════════════════════════════════════════════════════

export const balancedTokens = {
  colors,
  spacing,
  typography,
  effects,
  waypointTypes,
  zIndex,
  panelPosition,
  interaction,
} as const

export default balancedTokens
