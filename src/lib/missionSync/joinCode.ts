/** Human-readable mission join code (LAN discovery + UI). Not a secret — joinToken still required. */

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function joinCodeFromToken(joinToken: string): string {
  if (!joinToken) return '------'
  let hash = 0
  for (let i = 0; i < joinToken.length; i += 1) {
    hash = (hash * 33 + joinToken.charCodeAt(i)) >>> 0
  }
  let code = ''
  for (let i = 0; i < 6; i += 1) {
    hash = (hash * 1103515245 + 12345) >>> 0
    code += CODE_ALPHABET[hash % CODE_ALPHABET.length]!
  }
  return `${code.slice(0, 3)}-${code.slice(3)}`
}

export function normalizeJoinCodeInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function joinCodesMatch(joinToken: string, userInput: string): boolean {
  const expected = normalizeJoinCodeInput(joinCodeFromToken(joinToken))
  const got = normalizeJoinCodeInput(userInput)
  return expected.length === 6 && got === expected
}
