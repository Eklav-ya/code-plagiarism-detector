// /api/check.js  — Vercel Edge Function
// Edge runtime has NO timeout limit (vs 10s on Hobby serverless)
// This restores llama-3.3-70b-versatile with full quality results

export const config = { runtime: "edge" };

export default async function handler(req) {
  // ── CORS preflight ────────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Read body ─────────────────────────────────────────────────────────────
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Force the fast, capable model with safe token limit ──────────────────
  // llama-3.3-70b-versatile gives high-quality analysis.
  // Edge runtime handles the longer response time with no issues.
  const payload = {
    ...body,
    model: "llama-3.3-70b-versatile",
    max_tokens: 800,     // enough for full JSON findings without bloat
    temperature: 0,      // deterministic for consistency
  };

  // ── Forward to Groq ───────────────────────────────────────────────────────
  let groqRes;
  try {
    groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: { message: `Network error reaching Groq: ${err.message}` } }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── Stream Groq's response straight back to the client ───────────────────
  // We read it fully first so we can forward the exact status code.
  const groqText = await groqRes.text();

  return new Response(groqText, {
    status: groqRes.status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
