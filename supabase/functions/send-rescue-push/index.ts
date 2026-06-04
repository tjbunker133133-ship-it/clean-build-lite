import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import webpush from "npm:web-push@3.6.7";
import { verifyRescuePacketBody } from "../_shared/rescueVerify.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-z0-9]{16,64}$/i;
const SOURCE_EXPECTED = "tactical-hud";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function subjectForTrigger(t: string): string {
  if (t === "SOS") return "[SOS ALERT]";
  if (t === "DEADMAN") return "[DEADMAN ALERT]";
  return "[CHECK-IN]";
}

function buildPushPayload(body: Record<string, unknown>): {
  title: string;
  body: string;
  tag: string;
  data: Record<string, unknown>;
} {
  const triggerType = typeof body.triggerType === "string" ? body.triggerType : "ALERT";
  const operatorName =
    typeof (body.operator as Record<string, unknown> | undefined)?.display_name === "string"
      ? String((body.operator as Record<string, unknown>).display_name)
      : "Operator";
  const coords = body.coordinates as { lat?: number; lng?: number } | null | undefined;
  let mapUrl = "/";
  if (coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
    mapUrl = `/?lat=${coords.lat.toFixed(5)}&lng=${coords.lng.toFixed(5)}`;
  }
  const title = `${subjectForTrigger(triggerType)} Signal One HUD`;
  const lines = [`${operatorName} — ${triggerType} alert`, `Time (UTC): ${String(body.timestamp ?? "")}`];
  if (coords && typeof coords.lat === "number" && typeof coords.lng === "number") {
    lines.push(`Location: ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
  } else {
    lines.push("Location: not available");
  }
  return {
    title,
    body: lines.join(" · "),
    tag: `rescue-${triggerType}-${String(body.timestamp ?? Date.now())}`,
    data: { url: mapUrl, triggerType },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { code: "METHOD_NOT_ALLOWED", message: "Use POST" });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { code: "BAD_PAYLOAD", message: "Invalid JSON body" });
  }

  const verified = await verifyRescuePacketBody(raw);
  if (!verified.ok) {
    return json(verified.code === "INVALID_SIGNATURE" ? 401 : 400, {
      code: verified.code,
      message: verified.message,
    });
  }

  const body = verified.body;
  if (body.source !== SOURCE_EXPECTED) {
    return json(400, { code: "BAD_PAYLOAD", message: `source must be "${SOURCE_EXPECTED}"` });
  }

  const watchToken =
    typeof body.alertWatchToken === "string" ? body.alertWatchToken.trim() : "";
  if (!TOKEN_RE.test(watchToken)) {
    return json(400, { code: "NO_WATCH_TOKEN", message: "alertWatchToken required for push dispatch" });
  }

  const contactsField = body.contacts;
  if (!Array.isArray(contactsField) || contactsField.length === 0) {
    return json(400, { code: "NO_RECIPIENTS", message: "contacts array required" });
  }

  const emails = new Set<string>();
  for (const item of contactsField) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const rawChannel =
      typeof row.alertChannel === "string"
        ? row.alertChannel.trim()
        : typeof row.alert_channel === "string"
          ? row.alert_channel.trim()
          : "both";
    if (rawChannel === "email") continue;
    const email =
      typeof row.email === "string" ? String(row.email).trim().toLowerCase() : "";
    if (EMAIL_RE.test(email)) emails.add(email);
  }
  if (emails.size === 0) {
    return json(400, { code: "NO_RECIPIENTS", message: "No valid contact emails" });
  }

  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:signalonehud@gmail.com";
  if (!vapidPublic || !vapidPrivate) {
    return json(500, { code: "CONFIG_ERROR", message: "VAPID keys not configured" });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { code: "CONFIG_ERROR", message: "Supabase service role not configured" });
  }

  const client = createClient(supabaseUrl, serviceKey);
  const { data: rows, error } = await client
    .from("alert_push_subscriptions")
    .select("endpoint, p256dh, auth_secret, contact_email")
    .eq("watch_token", watchToken)
    .in("contact_email", [...emails]);

  if (error) {
    return json(500, { code: "DB_ERROR", message: "Could not load subscriptions" });
  }

  const payload = buildPushPayload(body);
  const pushBody = JSON.stringify(payload);
  let sentCount = 0;
  const staleEndpoints: string[] = [];

  for (const row of rows ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth_secret },
        },
        pushBody,
        { TTL: 86400 },
      );
      sentCount += 1;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        staleEndpoints.push(row.endpoint);
      }
    }
  }

  if (staleEndpoints.length > 0) {
    await client.from("alert_push_subscriptions").delete().in("endpoint", staleEndpoints);
  }

  return json(200, {
    ok: true,
    sentCount,
    matchedSubscriptions: rows?.length ?? 0,
  });
});
