import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Both `SOSPanel.tsx` and `DeadManPanel.tsx` carry an identical
// `resolveRapidEndpoint(): string` helper. They are intentionally
// duplicated (avoiding a refactor on the working dispatch path), so we
// lock byte-equality between the two definitions here. If a future edit
// changes one but not the other, this test fails immediately and the
// dispatch fallback order can't silently drift between SOS and Deadman.
//
// The fallback order under test is:
//   VITE_RESCUE_EMAIL_URL  →  VITE_RAPID_ENDPOINT_URL  →  localStorage `heartbeatFnUrl`

function extractResolveRapidEndpoint(filePath: string): string {
  const src = readFileSync(filePath, 'utf8')
  const startMarker = 'function resolveRapidEndpoint(): string {'
  const start = src.indexOf(startMarker)
  if (start === -1) {
    throw new Error(`resolveRapidEndpoint not found in ${filePath}`)
  }
  // Walk braces from the opening `{` to find the matching close.
  let i = src.indexOf('{', start)
  let depth = 0
  let end = -1
  for (; i < src.length; i += 1) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end === -1) {
    throw new Error(`resolveRapidEndpoint braces unbalanced in ${filePath}`)
  }
  return src.substring(start, end)
}

describe('resolveRapidEndpoint parity (SOSPanel vs DeadManPanel)', () => {
  it('both panels carry an identical resolver function body', () => {
    const root = process.cwd()
    const sos = extractResolveRapidEndpoint(join(root, 'src/hud/SOSPanel.tsx'))
    const dm = extractResolveRapidEndpoint(join(root, 'src/hud/DeadManPanel.tsx'))
    expect(sos).toBe(dm)
  })

  it('resolver references VITE_RESCUE_EMAIL_URL FIRST', () => {
    const sos = extractResolveRapidEndpoint(
      join(process.cwd(), 'src/hud/SOSPanel.tsx'),
    )
    const rescuePos = sos.indexOf('VITE_RESCUE_EMAIL_URL')
    const rapidPos = sos.indexOf('VITE_RAPID_ENDPOINT_URL')
    const heartbeatPos = sos.indexOf('heartbeatFnUrl')
    expect(rescuePos).toBeGreaterThan(-1)
    expect(rapidPos).toBeGreaterThan(-1)
    expect(heartbeatPos).toBeGreaterThan(-1)
    expect(rescuePos).toBeLessThan(rapidPos)
    expect(rapidPos).toBeLessThan(heartbeatPos)
  })
})
