/**
 * Structured runtime logger.
 *
 * - DEV: full verbose output to console (info/log/warn).
 * - PROD: only `warn` and `error` channels reach the console; info/log are
 *   silenced by default. The literal `import.meta.env.DEV` flag is replaced
 *   at build time, so the silenced branches are dead code in PROD bundles.
 *
 * Every log line is prefixed with a structured tag so production console
 * output (when warnings do occur) is grep-friendly:
 *
 *   [RUNTIME] device snapshot { ... }
 *   [VOICE]   state arming -> starting
 *   [SW]      activation: controlling
 *   [COMMAND] dispatch source=voice cmd=center -> ok
 *   [DEVICE]  interaction mode change desktop -> mobile
 *
 * No PII is ever logged (UA strings are truncated to 80 chars).
 */

export type LogCategory =
  | 'RUNTIME'
  | 'VOICE'
  | 'SW'
  | 'COMMAND'
  | 'COMMAND_EXEC'
  | 'COMMAND_OK'
  | 'COMMAND_FAIL'
  | 'COMMAND_TIMEOUT'
  | 'DEVICE'
  | 'PERMISSION'
  | 'DEADMAN'

const isDev = (() => {
  try {
    return import.meta.env.DEV === true
  } catch {
    return false
  }
})()

function format(category: LogCategory, msg: string): string {
  return `[${category}] ${msg}`
}

function safePayload(payload: unknown): unknown {
  if (payload == null) return payload
  if (typeof payload === 'string') return payload.length > 240 ? payload.slice(0, 240) + '…' : payload
  return payload
}

export function logInfo(category: LogCategory, msg: string, payload?: unknown): void {
  if (!isDev) return
  if (payload === undefined) console.log(format(category, msg))
  else console.log(format(category, msg), safePayload(payload))
}

export function logWarn(category: LogCategory, msg: string, payload?: unknown): void {
  if (payload === undefined) console.warn(format(category, msg))
  else console.warn(format(category, msg), safePayload(payload))
}

export function logError(category: LogCategory, msg: string, payload?: unknown): void {
  if (payload === undefined) console.error(format(category, msg))
  else console.error(format(category, msg), safePayload(payload))
}
