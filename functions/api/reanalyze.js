// POST /api/reanalyze — re-run analysis, re-extracts from R2 if needed

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ""
  const CHUNK = 1024
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length)
    for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j])
  }
  return btoa(binary)
}

const ANALYSIS_PROMPT = `You are Black Box, a relationship communication intelligence system.
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

async function runAnalysis(env, conversationId, rawText) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o", input: ANALYSIS_PROMPT + "\n\nConversation:\n" + rawText })
  })
  const ct = res.headers.get("content-type") || ""
  if (!ct.includes("application/json")) throw new Error("OpenAI non-JSON (" + res.status + ")")
  const data = await res.json()
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
    JSON.stringify(analysis.topics || []), JSON.stringify(analysis.themes || []),
    JSON.stringify(analysis.key_insights || []), JSON.stringify(analysis.coaching_recommendations || []),
    JSON.stringify(analysis.horsemen || {}), JSON.stringify(analysis.repair || {}),
    JSON.stringify(analysis.validation_by_speaker || {}), now
  ).run()
  await env.DB.prepare("UPDATE conversations SET analysis_id = ?, status = 'complete', updated_at = ? WHERE id = ?")
    .bind(analysisId, now, conversationId).run()
  return { analysisId, analysis }
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 503)
  let body
  try { body = await request.json() } catch { return json({ error: "Invalid JSON" }, 400) }
  const { conversation_id } = body
  if (!conversation_id) return json({ error: "conversation_id required" }, 400)
  try {
    const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(conversation_id).first()
    if (!conv) return json({ error: "Conversation not found" }, 404)
    let rawText = conv.raw_text || ""
    if (!rawText) {
      if (conv.source_type === "screenshot" && conv.attachment_key) {
        const bucket = env.BLACKBOX_UPLOADS
        if (!bucket) return json({ error: "BLACKBOX_UPLOADS not configured" }, 503)
        const obj = await bucket.get(conv.attachment_key)
        if (!obj) return json({ error: "File not found in R2" }, 422)
        const arrayBuffer = await obj.arrayBuffer()
        if (arrayBuffer.byteLength === 0) return json({ error: "R2 file is empty" }, 422)
        const mimeType = obj.httpMetadata?.contentType || "image/jpeg"
        const safeMime = (mimeType === "image/heic" || mimeType === "image/heif") ? "image/jpeg" : mimeType
        const base64 = toBase64(arrayBuffer)
        const res = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o",
            input: [{ type: "message", role: "user", content: [
              { type: "input_image", image_url: { url: "data:" + safeMime + ";base64," + base64 } },
              { type: "input_text", text: "Extract the conversation text from this screenshot. Format each message as 'Speaker: message text'. If speakers are unclear use 'Person A' and 'Person B'. Return only the conversation text." }
            ]}]
          })
        })
        const ct = res.headers.get("content-type") || ""
        if (!ct.includes("application/json")) return json({ error: "OpenAI non-JSON (" + res.status + ")" }, 502)
        const data = await res.json()
        if (data.error) return json({ error: "OpenAI error: " + data.error.message }, 502)
        rawText = data.output?.[0]?.content?.[0]?.text || ""
        if (!rawText) return json({ error: "OpenAI vision returned empty text" }, 422)
        await env.DB.prepare("UPDATE conversations SET raw_text = ? WHERE id = ?").bind(rawText, conversation_id).run()
      } else if (conv.source_type === "audio") {
        return json({ error: "Audio transcript not available. Re-record through the RECORD button." }, 400)
      } else {
        return json({ error: "No content available to analyze." }, 400)
      }
    }
    const { analysisId, analysis } = await runAnalysis(env, conversation_id, rawText)
    return json({
      ok: true, analysis_id: analysisId, conversation_id,
      analysis: {
        id: analysisId,
        quality_score: analysis.quality_score || 0,
        escalation_score: analysis.escalation_score || 0,
        outcome: analysis.outcome || "unresolved",
        key_insights: analysis.key_insights || [],
        coaching_recommendations: analysis.coaching_recommendations || [],
      }
    })
  } catch (err) { return json({ error: "Re-analysis failed", detail: String(err) }, 500) }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
