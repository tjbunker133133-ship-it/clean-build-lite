/**
 * Edge Function: send-rescue-email (Gmail SMTP)
 *
 * Contract (strict): matches `buildRescuePacket` output from tactical-hud.
 *
 * Transport: Gmail SMTP over TLS (smtp.gmail.com:465) via `denomailer`.
 * Replaces the previous Resend HTTP transport so rescue emails can be
 * delivered to arbitrary emergency contacts without sandbox restrictions.
 * The validation / HMAC verification / AES-GCM contact-decryption layers
 * are unchanged — only the final outbound transport is different.
 *
 * Secrets:
 *   - GMAIL_USER              (required; the authenticated Gmail address;
 *                              this is also the SMTP MAIL FROM)
 *   - GMAIL_APP_PASSWORD      (required; a 16-character Google App Password,
 *                              NOT the account password)
 *   - RESCUE_SIGNING_KEY      (required; HMAC signing key, must match the
 *                              frontend `VITE_RESCUE_SIGNING_KEY`)
 *   - CONTACT_ENCRYPTION_KEY  (optional; required ONLY when payload arrives
 *                              with encrypted contacts. 32-byte raw key,
 *                              base64-encoded.)
 *
 * Gmail App Password setup:
 *   1. Enable 2-Step Verification on the sending Google Account.
 *   2. Visit https://myaccount.google.com/apppasswords and generate an
 *      app password labeled e.g. "tactical-hud rescue dispatch".
 *   3. Store both values as Supabase secrets:
 *
 *      npx supabase secrets set GMAIL_USER=<gmail-address> \
 *        --project-ref nlrwmtzphoazktmseadb
 *      npx supabase secrets set GMAIL_APP_PASSWORD=<google-app-password> \
 *        --project-ref nlrwmtzphoazktmseadb
 *
 *   The encryption secret (only if you ever switch the frontend to send
 *   `contacts_encrypted`) is set the same way:
 *      npx supabase secrets set CONTACT_ENCRYPTION_KEY=<32-byte-base64-key> \
 *        --project-ref nlrwmtzphoazktmseadb
 *
 * Encryption format (AES-256-GCM via Web Crypto):
 *   ciphertext_blob = IV(12) || ciphertext+authTag
 *   wire format     = base64(ciphertext_blob)
 *   plaintext       = JSON.stringify(Array<{ name, email }>)
 *
 * Decryption happens here only. Plaintext contacts are NEVER logged and
 * NEVER returned in responses — only the post-validation email addresses
 * (which are required for the response to be useful) are echoed back.
 */

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SOURCE_EXPECTED = "tactical-hud";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Deterministic JSON canonicalization (sorted keys) — must match the
// frontend's `canonicalJSON` byte-for-byte. Used as the message input to
// HMAC verification.
function canonicalJSON(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
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

async function loadSigningKey(): Promise<CryptoKey | null> {
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

/**
 * Timing-safe HMAC verification via Web Crypto's `verify`, which performs
 * constant-time comparison internally. Returns true only on exact match.
 * Never logs the signature or expected MAC; never echoes them.
 */
async function verifyHmacSignature(
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

const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;
const AES_KEY_BYTES = 32;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function loadEncryptionKey(): Promise<CryptoKey | null> {
  const raw = Deno.env.get("CONTACT_ENCRYPTION_KEY");
  if (!raw || raw.trim().length === 0) return null;
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(raw.trim());
  } catch {
    return null;
  }
  if (bytes.length !== AES_KEY_BYTES) return null;
  try {
    return await crypto.subtle.importKey(
      "raw",
      bytes,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

/**
 * Helper available for off-line use (e.g. an admin script seeding the
 * frontend's encrypted-payload mode in a future change). Not invoked by
 * the request handler today.
 */
export async function encryptContacts(
  contacts: { name: string; email: string }[],
  key: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(AES_IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(contacts));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext),
  );
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return bytesToBase64(combined);
}

export async function decryptContacts(
  encrypted: string,
  key: CryptoKey,
): Promise<unknown> {
  const combined = base64ToBytes(encrypted);
  if (combined.length < AES_IV_BYTES + AES_TAG_BYTES) {
    throw new Error("ciphertext too short");
  }
  const iv = combined.subarray(0, AES_IV_BYTES);
  const body = combined.subarray(AES_IV_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    body,
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

function jsonErr(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      code,
      message,
      ...extra,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

type ValidPacket = {
  triggerType: "SOS" | "DEADMAN";
  timestamp: string;
  coordinates: { lat: number; lng: number } | null;
  contacts: { name: string; email: string }[];
  source: typeof SOURCE_EXPECTED;
};

function parseAndValidate(body: unknown):
  | { ok: true; packet: ValidPacket; filteredOut: number }
  | { ok: false; response: Response } {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      response: jsonErr(400, "BAD_PAYLOAD", "Body must be a JSON object"),
    };
  }

  const o = body as Record<string, unknown>;

  const triggerType = o.triggerType;
  if (triggerType !== "SOS" && triggerType !== "DEADMAN") {
    return {
      ok: false,
      response: jsonErr(
        400,
        "BAD_PAYLOAD",
        'triggerType must be "SOS" or "DEADMAN"',
      ),
    };
  }

  const timestamp = o.timestamp;
  if (typeof timestamp !== "string" || timestamp.trim().length === 0) {
    return {
      ok: false,
      response: jsonErr(400, "BAD_PAYLOAD", "timestamp must be a non-empty string"),
    };
  }

  const source = o.source;
  if (source !== SOURCE_EXPECTED) {
    return {
      ok: false,
      response: jsonErr(
        400,
        "BAD_PAYLOAD",
        `source must be "${SOURCE_EXPECTED}"`,
      ),
    };
  }

  const coordsRaw = o.coordinates;
  let coordinates: { lat: number; lng: number } | null = null;
  if (coordsRaw === undefined || coordsRaw === null) {
    coordinates = null;
  } else if (typeof coordsRaw === "object" && !Array.isArray(coordsRaw)) {
    const c = coordsRaw as Record<string, unknown>;
    if (isFiniteNum(c.lat) && isFiniteNum(c.lng)) {
      coordinates = { lat: c.lat, lng: c.lng };
    } else {
      return {
        ok: false,
        response: jsonErr(
          400,
          "BAD_PAYLOAD",
          "coordinates must be null or { lat: number, lng: number }",
        ),
      };
    }
  } else {
    return {
      ok: false,
      response: jsonErr(
        400,
        "BAD_PAYLOAD",
        "coordinates must be null or { lat: number, lng: number }",
      ),
    };
  }

  const contactsField = o.contacts;
  if (contactsField === undefined || contactsField === null) {
    return {
      ok: false,
      response: jsonErr(400, "NO_CONTACTS", "contacts field is required"),
    };
  }
  if (!Array.isArray(contactsField)) {
    return {
      ok: false,
      response: jsonErr(400, "NO_CONTACTS", "contacts must be an array"),
    };
  }

  if (contactsField.length === 0) {
    return {
      ok: false,
      response: jsonErr(400, "NO_RECIPIENTS", "contacts array is empty"),
    };
  }

  const cleaned: { name: string; email: string }[] = [];
  let filteredOut = 0;

  for (const item of contactsField) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      filteredOut++;
      continue;
    }
    const row = item as Record<string, unknown>;
    const email = typeof row.email === "string" ? row.email.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!EMAIL_RE.test(email)) {
      filteredOut++;
      continue;
    }
    cleaned.push({
      name: name.length > 0 ? name : "Contact",
      email,
    });
  }

  if (cleaned.length === 0) {
    return {
      ok: false,
      response: jsonErr(
        400,
        "NO_RECIPIENTS",
        "No valid email recipients after validation",
        { filteredOut },
      ),
    };
  }

  return {
    ok: true,
    packet: {
      triggerType,
      timestamp: timestamp.trim(),
      coordinates,
      contacts: cleaned,
      source: SOURCE_EXPECTED,
    },
    filteredOut,
  };
}

function buildEmailText(p: ValidPacket, recipientName: string): string {
  const greetingName = recipientName.trim().length > 0 ? recipientName.trim() : "there";
  const lines: string[] = [
    `Hello ${greetingName},`,
    ``,
    `Tactical HUD emergency notification.`,
    ``,
    `Trigger: ${p.triggerType}`,
    `Time (UTC): ${p.timestamp}`,
  ];

  if (p.coordinates) {
    const lat = p.coordinates.lat.toFixed(6);
    const lng = p.coordinates.lng.toFixed(6);
    lines.push(``);
    lines.push(`Latitude: ${lat}`);
    lines.push(`Longitude: ${lng}`);
    lines.push(`Map: https://maps.google.com/?q=${lat},${lng}`);
  } else {
    lines.push(``);
    lines.push(`Coordinates: not available`);
  }

  lines.push(``);
  lines.push(`Source: ${p.source}`);
  lines.push(`---`);
  lines.push(`This message was sent because this address is registered as an emergency contact.`);

  return lines.join("\n");
}

function subjectForTrigger(t: "SOS" | "DEADMAN"): string {
  return t === "SOS" ? "[SOS ALERT]" : "[DEADMAN ALERT]";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonErr(405, "METHOD_NOT_ALLOWED", "Use POST");
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonErr(400, "BAD_PAYLOAD", "Invalid JSON body");
  }

  // ── Strict HMAC signing gate ────────────────────────────────────────
  // Verifies request authenticity before any other processing. Strict
  // mode: missing or invalid signature is rejected with 401. The same
  // INVALID_SIGNATURE code is returned for both cases so we don't leak
  // whether the field was missing vs malformed. The expected MAC is
  // never logged or returned.
  //
  // CONTRACT-SENSITIVE: ordering matters. The verification must sit
  // BEFORE decryption and validation so we never spend cycles or surface
  // diagnostics on unauthenticated payloads. Any change to canonical-JSON
  // semantics here must be mirrored in
  // `src/lib/rescue/buildRescuePacket.ts::canonicalJSON` or every signed
  // packet from the field will start failing 401.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return jsonErr(400, "BAD_PAYLOAD", "Body must be a JSON object");
  }
  {
    const o = raw as Record<string, unknown>;
    const signature = typeof o.signature === "string" ? o.signature : "";
    if (signature.length === 0) {
      return jsonErr(401, "INVALID_SIGNATURE", "Missing or invalid signature");
    }
    const signingKey = await loadSigningKey();
    if (!signingKey) {
      return jsonErr(
        500,
        "CONFIG_ERROR",
        "RESCUE_SIGNING_KEY not set on project secrets",
      );
    }
    // Build a copy without the signature field; sign over the canonical
    // form. The original body retains all other fields for downstream use.
    const { signature: _omit, ...rest } = o;
    void _omit;
    const ok = await verifyHmacSignature(signingKey, canonicalJSON(rest), signature);
    if (!ok) {
      return jsonErr(401, "INVALID_SIGNATURE", "Missing or invalid signature");
    }
    // Strip signature from the working payload so downstream stages don't
    // see or log it.
    delete o.signature;
  }

  // Backward-compatible encryption layer.
  // We accept TWO contact shapes from the frontend:
  //   (a) plain (current frontend):   { contacts: [...] }
  //   (b) encrypted (forward-compat): { contacts_encrypted: "base64..." }
  //                                   or { contacts: "base64..." }
  // When either string form is present we MUST decrypt it before
  // validation. Decryption never logs or returns plaintext.
  //
  // CONTRACT-SENSITIVE: AES-256-GCM with the wire format
  // base64( IV(12) || ciphertext+authTag ). Plaintext is JSON of the
  // contacts array. Changing key derivation, IV size, or wire layout
  // here MUST be matched by an offline migration of any in-flight
  // encrypted payloads.
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const encryptedString =
      typeof o.contacts_encrypted === "string"
        ? o.contacts_encrypted
        : typeof o.contacts === "string"
          ? o.contacts
          : null;
    if (encryptedString !== null) {
      const aesKey = await loadEncryptionKey();
      if (!aesKey) {
        return jsonErr(
          500,
          "CONFIG_ERROR",
          "CONTACT_ENCRYPTION_KEY missing or invalid (must be 32-byte base64)",
        );
      }
      let contacts_encrypted: string | null = encryptedString;
      let decoded: unknown;
      try {
        decoded = await decryptContacts(contacts_encrypted, aesKey);
      } catch {
        contacts_encrypted = null;
        return jsonErr(
          400,
          "CONTACT_DECRYPTION_FAILED",
          "Unable to decrypt contacts payload",
        );
      }
      contacts_encrypted = null;
      if (!Array.isArray(decoded)) {
        return jsonErr(
          400,
          "CONTACT_DECRYPTION_FAILED",
          "Decrypted contacts is not an array",
        );
      }
      o.contacts = decoded;
      delete o.contacts_encrypted;
    }
  }

  const parsed = parseAndValidate(raw);
  if (!parsed.ok) {
    return parsed.response;
  }

  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPass = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!gmailUser || gmailUser.trim().length === 0) {
    return jsonErr(
      500,
      "CONFIG_ERROR",
      "GMAIL_USER not set on project secrets",
    );
  }
  if (!gmailPass || gmailPass.trim().length === 0) {
    return jsonErr(
      500,
      "CONFIG_ERROR",
      "GMAIL_APP_PASSWORD not set on project secrets",
    );
  }

  const fromAddress = gmailUser.trim();
  const { packet, filteredOut } = parsed;
  const subject = subjectForTrigger(packet.triggerType);

  const sentEmails: string[] = [];
  const errors: { email: string; detail: string }[] = [];

  // CONTRACT-SENSITIVE: Gmail SMTPS transport (smtp.gmail.com:465, implicit
  // TLS). The transport contract is:
  //   - one connection per request, reused for every recipient
  //   - one email per contact (no batching, preserves per-recipient errors)
  //   - connection closed in `finally` so partial failure never leaves a
  //     socket dangling
  //   - per-recipient failures captured in `errors[]` and surfaced via the
  //     existing partial-send / `RESEND_ERROR`-shaped response below
  // The response shape (200 / 207 / 502 with `errors[]`) is preserved
  // byte-for-byte from the original Resend transport so the frontend
  // status-string mapping never changes. Any future transport swap must
  // preserve the same response contract.
  const smtp = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: {
        username: fromAddress,
        password: gmailPass.trim(),
      },
    },
  });

  try {
    for (const c of packet.contacts) {
      const text = buildEmailText(packet, c.name);
      try {
        await smtp.send({
          from: fromAddress,
          to: c.email,
          subject,
          content: text,
        });
        sentEmails.push(c.email);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        errors.push({
          email: c.email,
          detail: detail.slice(0, 400),
        });
      }
    }
  } finally {
    try {
      await smtp.close();
    } catch {
      // socket already torn down; non-fatal
    }
  }

  if (sentEmails.length === 0) {
    return jsonErr(502, "RESEND_ERROR", "All recipient sends failed", {
      errors,
      filteredOut,
    });
  }

  if (errors.length > 0) {
    return new Response(
      JSON.stringify({
        ok: true,
        partial: true,
        code: "PARTIAL_SEND",
        sent: sentEmails.length,
        contacts: sentEmails,
        failed: errors,
        filteredOut,
      }),
      {
        status: 207,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      sent: sentEmails.length,
      contacts: sentEmails,
      filteredOut,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
