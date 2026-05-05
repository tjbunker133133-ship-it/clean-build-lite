/**
 * Supabase Edge Function: send-rescue-email (Resend)
 *
 * 1. Add secret RESEND_API_KEY (and optional RESEND_FROM) in Supabase Dashboard.
 * 2. Uncomment the IMPLEMENTATION block below.
 * 3. Comment out or remove the STUB handler at the bottom.
 * 4. Deploy: supabase functions deploy send-rescue-email
 *
 * Request JSON: { to_emails, user_name, location, route, timestamp, lat?, lon?,
 *   corridor_deviation?, trigger_source?, last_heartbeat?, test? }
 */

/*
 * --- IMPLEMENTATION (uncomment entire block when RESEND_API_KEY is set) ---
 *
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function buildPlainBody(payload: Record<string, unknown>): string {
  const lines = [
    `TITANIUM HUD — Rescue / alert`,
    ``,
    `Operator: ${String(payload.user_name ?? "—")}`,
    `Time (UTC): ${String(payload.timestamp ?? "—")}`,
    `Trigger: ${String(payload.trigger_source ?? "—")}`,
    `GPS: ${String(payload.location ?? "—")} (lat ${payload.lat ?? "—"}, lon ${payload.lon ?? "—"})`,
    `Corridor / deviation: ${String(payload.corridor_deviation ?? "—")}`,
    `Last heartbeat: ${String(payload.last_heartbeat ?? "—")}`,
    ``,
    `Route pins:`,
    String(payload.route ?? "(none)"),
  ];
  return lines.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const key = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("RESEND_FROM") ?? "Titanium HUD <onboarding@resend.dev>";
  if (!key) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not set" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const rawTo = body.to_emails;
    const to_emails = Array.isArray(rawTo)
      ? rawTo.filter((e): e is string => typeof e === "string" && e.includes("@"))
      : [];
    if (to_emails.length === 0) {
      return new Response(JSON.stringify({ error: "to_emails required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const isTest = body.test === true;
    const userName = String(body.user_name ?? "Operator");
    const subject = isTest
      ? `[TEST] Titanium HUD — rescue email check (${userName})`
      : `TITANIUM HUD EMERGENCY — ${userName} requires rescue`;
    const text = buildPlainBody(body);
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: to_emails, subject, text }),
    });
    const resText = await res.text();
    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: "Resend API error", detail: resText.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
 *
 * --- END IMPLEMENTATION ---
 */

const stubCors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Default deploy: returns 503 until IMPLEMENTATION above is uncommented and RESEND_API_KEY is set. */
Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: stubCors });
  }
  return new Response(
    JSON.stringify({
      ok: false,
      error:
        "send-rescue-email stub — uncomment Resend implementation in index.ts and set RESEND_API_KEY",
    }),
    {
      status: 503,
      headers: { ...stubCors, "Content-Type": "application/json" },
    },
  );
});
