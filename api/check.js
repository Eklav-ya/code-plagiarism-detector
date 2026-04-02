export const config = { runtime: "edge" };

export default async function handler(req) {
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

  const payload = {
    ...body,
    model: "llama-3.3-70b-versatile",
    max_tokens: 800,
    temperature: 0,
  };

  // Retry up to 4 times with exponential backoff on 429
  const MAX_RETRIES = 4;
  let lastStatus = 500;
  let lastText = "";

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const waitMs = Math.pow(2, attempt) * 1500; // 3s, 6s, 12s
      await new Promise(res => setTimeout(res, waitMs));
    }

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
      lastText = JSON.stringify({ error: { message: `Network error: ${err.message}` } });
      continue;
    }

    lastStatus = groqRes.status;
    lastText = await groqRes.text();

    if (groqRes.status !== 429) break; // success or non-retryable error
  }

  return new Response(lastText, {
    status: lastStatus,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}