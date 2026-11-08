// Model layer. One function, swappable provider via env vars:
//   LLM_PROVIDER = "gemini" (default) | "openai"  (any OpenAI-compatible chat API)
//   Gemini:  GEMINI_API_KEY, GEMINI_MODEL (default gemini-3.5-flash-lite (fast; bigger models were 15-60s per call on the free tier))
//   OpenAI-compatible: LLM_API_KEY, LLM_MODEL, LLM_BASE_URL (default https://api.openai.com/v1)

export interface LlmRequest {
  system: string;
  user: string;
  json?: boolean; // ask for a JSON object back
}

async function gemini(req: LlmRequest): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts: [{ text: req.user }] }],
        generationConfig: {
          temperature: 0.2,
          ...(req.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("");
  if (!text) throw new Error("Gemini returned no text");
  return text;
}

async function openaiCompatible(req: LlmRequest): Promise<string> {
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!key || !model) throw new Error("LLM_API_KEY and LLM_MODEL must be set");
  const base = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      ...(req.json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`LLM error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("LLM returned no text");
  return text;
}

export async function llm(req: LlmRequest): Promise<string> {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  const call = provider === "openai" ? openaiCompatible : gemini;
  // Free tiers rate-limit per minute: wait and retry on 429 instead of failing the user.
  for (let attempt = 0; ; attempt++) {
    try {
      return await call(req);
    } catch (e) {
      const limited = e instanceof Error && /error (429|500|503)/.test(e.message); // rate limit or provider overloaded
      if (!limited || attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
    }
  }
}

export async function llmJson<T>(req: Omit<LlmRequest, "json">): Promise<T> {
  const parse = (s: string): T => {
    const cleaned = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    return JSON.parse(cleaned) as T;
  };
  const first = await llm({ ...req, json: true });
  try {
    return parse(first);
  } catch {
    const second = await llm({
      ...req,
      json: true,
      user: req.user + "\n\nYour previous answer was not valid JSON. Return ONLY one valid JSON object.",
    });
    return parse(second);
  }
}
