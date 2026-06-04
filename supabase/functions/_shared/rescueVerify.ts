/** Shared HMAC verification for rescue edge functions (must match buildRescuePacket). */

export function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") + "}";
  }
  return "null";
}

function hexToBytes(hex: string): Uint8Array | null {
  const s = hex.trim().toLowerCase();
  if (s.length === 0 || s.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(s)) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(s.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function loadSigningKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("RESCUE_SIGNING_KEY");
  if (!raw || raw.trim().length === 0) return null;
  try {
    return await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(raw),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }
}

export async function verifyHmacSignature(
  key: CryptoKey,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  const sigBytes = hexToBytes(signatureHex);
  if (!sigBytes) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes,
      new TextEncoder().encode(message),
    );
  } catch {
    return false;
  }
}

export type VerifiedRescueBody = Record<string, unknown>;

/** Verify signature and return body without `signature` field. */
export async function verifyRescuePacketBody(
  raw: unknown,
): Promise<{ ok: true; body: VerifiedRescueBody } | { ok: false; code: string; message: string }> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "BAD_PAYLOAD", message: "Body must be a JSON object" };
  }
  const o = raw as Record<string, unknown>;
  const signature = typeof o.signature === "string" ? o.signature : "";
  if (signature.length === 0) {
    return { ok: false, code: "INVALID_SIGNATURE", message: "Missing or invalid signature" };
  }
  const signingKey = await loadSigningKey();
  if (!signingKey) {
    return { ok: false, code: "CONFIG_ERROR", message: "RESCUE_SIGNING_KEY not set on project secrets" };
  }
  const { signature: _omit, ...rest } = o;
  void _omit;
  const valid = await verifyHmacSignature(signingKey, canonicalJSON(rest), signature);
  if (!valid) {
    return { ok: false, code: "INVALID_SIGNATURE", message: "Missing or invalid signature" };
  }
  return { ok: true, body: rest };
}
