// Shared utilities for all Black Box Pages Functions

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

export const options = () => new Response(null, { headers: CORS })

// Safe base64 encoding for Cloudflare Workers — chunked to avoid call stack overflow
export function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ""
  const CHUNK = 1024
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length)
    for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j])
  }
  return btoa(binary)
}

// Safe JSON parse for API responses
export async function safeJson(res) {
  const ct = res.headers.get("content-type") || ""
  if (!ct.includes("application/json")) {
    const text = await res.text()
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 100)}`)
  }
  return res.json()
}

export const ANALYSIS_PROMPT = `You are Black Box, a relationship communication intelligence system.
Analyze this conversation and return ONLY a valid JSON object — no preamble, no markdown fences:
{
  "quality_score": <0-100>,
  "escalation_score": <0-100>,
  "validation_score": <0-100>,
  "collaboration_score": <0-100>,
  "topic_drift_score": <0-100>,
  "resolution_probability": <0.0-1.0>,
  "interruption_rate_a": <0-100>,
  "interruption_rate_b": <0-100>,
  "outcome": "<resolved|unresolved|escalated|deferred>",
  "topics": ["<topic>"],
  "themes": ["<theme>"],
  "key_insights": ["<insight1>", "<insight2>", "<insight3>", "<insight4>"],
  "coaching_recommendations": ["<rec1>", "<rec2>", "<rec3>"],
  "validation_by_speaker": { "<name>": <0-100> },
  "horsemen": {
    "criticism": <0-100>, "defensiveness": <0-100>,
    "contempt": <0-100>, "stonewalling": <0-100>,
    "overall": <0-100>, "trend": "<rising|falling|stable>",
    "speaker_breakdown": {}, "examples": []
  },
  "repair": {
    "validation_attempts": <number>, "accountability_attempts": <number>,
    "compromise_attempts": <number>, "appreciation_attempts": <number>,
    "successful_repairs": <number>, "failed_repairs": <number>,
    "recovery_time_minutes": <number>, "resilience_score": <0-100>
  }
}
Do NOT determine who is right. Identify communication patterns only.`

export async function runAnalysis(env, conversationId, rawText) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      input: ANALYSIS_PROMPT + "\n\nConversation:\n" + rawText
    })
  })
  const data = await safeJson(res)
  const text = data.output?.[0]?.content?.[0]?.text || "{}"
  let analysis = {}
  try { analysis = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) } catch {}

  const analysisId = crypto.randomUUID()
  const now = new Date().toISOString()

  await env.DB.prepare(`
    INSERT INTO analysis_runs (
      id, conversation_id, quality_score, escalation_score, validation_score,
      collaboration_score, topic_drift_score, resolution_probability,
      interruption_rate_a, interruption_rate_b,
      outcome, topics, themes, key_insights, coaching_recommendations,
      horsemen_data, repair_data, validation_by_speaker, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete', ?)
  `).bind(
    analysisId, conversationId,
    analysis.quality_score || 0, analysis.escalation_score || 0,
    analysis.validation_score || 0, analysis.collaboration_score || 0,
    analysis.topic_drift_score || 0, analysis.resolution_probability || 0,
    analysis.interruption_rate_a || 0, analysis.interruption_rate_b || 0,
    analysis.outcome || "unresolved",
    JSON.stringify(analysis.topics || []),
    JSON.stringify(analysis.themes || []),
    JSON.stringify(analysis.key_insights || []),
    JSON.stringify(analysis.coaching_recommendations || []),
    JSON.stringify(analysis.horsemen || {}),
    JSON.stringify(analysis.repair || {}),
    JSON.stringify(analysis.validation_by_speaker || {}),
    now
  ).run()

  await env.DB.prepare(
    "UPDATE conversations SET analysis_id = ?, status = 'complete', updated_at = ? WHERE id = ?"
  ).bind(analysisId, now, conversationId).run()

  return { analysisId, analysis }
}
