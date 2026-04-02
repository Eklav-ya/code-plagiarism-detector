export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GROQ_API_KEY;
  
  // ADD THIS ↓
  console.log("KEY EXISTS:", !!apiKey);
  console.log("BODY:", JSON.stringify(req.body));

  if (!apiKey) {
    return res.status(500).json({ error: "API key not configured on server." });
  }

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (err) {
    // REPLACE THE CATCH WITH THIS ↓
    console.log("FETCH ERROR:", err.message, err.cause?.message);
    return res.status(500).json({ 
      error: err.message,
      type: err.name,
      cause: err.cause?.message
    });
  }
}