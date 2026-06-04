import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_RE = /^[a-z0-9]{16,64}$/i;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET" || req.method === "HEAD") {
    return json(200, {
      ok: true,
      service: "register-alert-push",
      methods: ["POST"],
      hint: "POST JSON with watchToken, contactEmail, subscription",
    });
  }
  if (req.method !== "POST") {
    return json(405, { code: "METHOD_NOT_ALLOWED", message: "Use POST" });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json(400, { code: "BAD_PAYLOAD", message: "Invalid JSON body" });
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return json(400, { code: "BAD_PAYLOAD", message: "Body must be an object" });
  }
  const o = raw as Record<string, unknown>;
  const watchToken = typeof o.watchToken === "string" ? o.watchToken.trim() : "";
  const contactEmail = typeof o.contactEmail === "string" ? o.contactEmail.trim().toLowerCase() : "";
  const subRaw = o.subscription;
  if (!TOKEN_RE.test(watchToken)) {
    return json(400, { code: "BAD_TOKEN", message: "Invalid watch token" });
  }
  if (!EMAIL_RE.test(contactEmail)) {
    return json(400, { code: "BAD_EMAIL", message: "Invalid contact email" });
  }
  if (subRaw === null || typeof subRaw !== "object" || Array.isArray(subRaw)) {
    return json(400, { code: "BAD_SUBSCRIPTION", message: "Invalid subscription" });
  }
  const sub = subRaw as Record<string, unknown>;
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint.trim() : "";
  const keys = sub.keys;
  if (!endpoint || keys === null || typeof keys !== "object" || Array.isArray(keys)) {
    return json(400, { code: "BAD_SUBSCRIPTION", message: "Invalid subscription keys" });
  }
  const keyObj = keys as Record<string, unknown>;
  const p256dh = typeof keyObj.p256dh === "string" ? keyObj.p256dh.trim() : "";
  const authSecret = typeof keyObj.auth === "string" ? keyObj.auth.trim() : "";
  if (!p256dh || !authSecret) {
    return json(400, { code: "BAD_SUBSCRIPTION", message: "Missing p256dh or auth" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json(500, { code: "CONFIG_ERROR", message: "Supabase service role not configured" });
  }

  const userAgent = typeof o.userAgent === "string" ? o.userAgent.slice(0, 240) : null;
  const client = createClient(supabaseUrl, serviceKey);
  const { error } = await client.from("alert_push_subscriptions").upsert(
    {
      watch_token: watchToken,
      contact_email: contactEmail,
      endpoint,
      p256dh,
      auth_secret: authSecret,
      user_agent: userAgent,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    console.error("[register-alert-push] upsert failed", error.code, error.message);
    return json(500, {
      code: "DB_ERROR",
      message: "Could not save subscription",
      detail: error.code ?? "unknown",
    });
  }

  return json(200, { ok: true });
});
