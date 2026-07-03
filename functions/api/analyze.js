// GET  /api/analyze?id=uuid — poll status; triggers analysis if status=pending
// POST /api/analyze        — analyze text conversation inline

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

async function extractTextFromImage(env, conv) {
  // Prefer OpenAI file_id if available
  let imageInput
  if (conv.openai_file_id) {
    imageInput = { type: "input_image", file_id: conv.openai_file_id }
  } else {
    // Fall back to base64 from R2
    if (!env.BLACKBOX_UPLOADS) throw new Error("BLACKBOX_UPLOADS not configured")
    const obj = await env.BLACKBOX_UPLOADS.get(conv.attachment_key)
    if (!obj) throw new Error("File not found in R2")
    const arrayBuffer = await obj.arrayBuffer()
    if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("R2 file is empty")
    const mimeType = obj.httpMetadata?.contentType || "image/jpeg"
    const safeMime = (mimeType === "image/heic" || mimeType === "image/heif") ? "image/jpeg" : mimeType
    imageInput = { type: "input_image", image_url: `data:${safeMime};base64,${toBase64(arrayBuffer)}` }
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      input: [{
        type: "message", role: "user",
        content: [
          imageInput,
          { type: "input_text", text: "Extract the full conversation text from this screenshot. Format each message as 'Speaker: message'. If speakers are unclear use 'Person A' and 'Person B'. Return only the conversation text, nothing else." }
        ]
      }]
    })
  })
  const ct = res.headers.get("content-type") || ""
  if (!ct.includes("application/json")) throw new Error(`Vision non-JSON (${res.status})`)
  const data = await res.json()
  if (data.error) throw new Error(`Vision API error: ${data.error.message}`)
  return data.output?.[0]?.content?.[0]?.text || ""
}

async function runAnalysis(env, conversationId, rawText) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o",
      input: [{ role: "user", content: ANALYSIS_PROMPT + "\n\nConversation:\n" + rawText }]
    })
  })
  const ct = res.headers.get("content-type") || ""
  if (!ct.includes("application/json")) throw new Error(`Analysis non-JSON (${res.status})`)
  const data = await res.json()
  if (data.error) throw new Error(`Analysis API error: ${data.error.message}`)
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

// ── GET — poll + trigger ───────────────────────────────────────────────────
export async function onRequestGet(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 503)

  const url = new URL(request.url)
  const id = url.searchParams.get("id")
  if (!id) return json({ error: "id required" }, 400)

  try {
    const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first()
    if (!conv) return json({ error: "Not found" }, 404)

    // Already complete — return analysis
    if (conv.status === "complete" && conv.analysis_id) {
      const analysis = await env.DB.prepare(
        "SELECT * FROM analysis_runs WHERE id = ? LIMIT 1"
      ).bind(conv.analysis_id).first().catch(() => null)

      if (analysis) {
        return json({
          status: "complete",
          raw_text: conv.raw_text,
          analysis: {
            ...analysis,
            topics: JSON.parse(analysis.topics || "[]"),
            themes: JSON.parse(analysis.themes || "[]"),
            key_insights: JSON.parse(analysis.key_insights || "[]"),
            coaching_recommendations: JSON.parse(analysis.coaching_recommendations || "[]"),
            horsemen: JSON.parse(analysis.horsemen_data || "{}"),
            repair: JSON.parse(analysis.repair_data || "{}"),
            validation_by_speaker: JSON.parse(analysis.validation_by_speaker || "{}"),
          }
        })
      }
    }

    // Failed — return error
    if (conv.status === "failed") {
      return json({ status: "failed", error: "Analysis failed" })
    }

    // Already analyzing — just return status (another poll is running it)
    if (conv.status === "analyzing") {
      return json({ status: "analyzing" })
    }

    // Pending or transcribed — trigger analysis now in this request
    if (conv.status === "pending" || conv.status === "transcribed") {
      // Mark as analyzing immediately to prevent duplicate triggers
      await env.DB.prepare(
        "UPDATE conversations SET status = 'analyzing', updated_at = ? WHERE id = ?"
      ).bind(new Date().toISOString(), id).run()

      let rawText = conv.raw_text || ""

      // If screenshot with no raw_text — extract from image first
      if (!rawText && conv.source_type === "screenshot") {
        try {
          rawText = await extractTextFromImage(env, conv)
          if (rawText) {
            await env.DB.prepare(
              "UPDATE conversations SET raw_text = ? WHERE id = ?"
            ).bind(rawText, id).run()
          }
        } catch (err) {
          console.error("Vision extraction failed:", String(err))
          await env.DB.prepare(
            "UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?"
          ).bind(new Date().toISOString(), id).run()
          return json({ status: "failed", error: "Image extraction failed: " + String(err) })
        }
      }

      if (!rawText) {
        await env.DB.prepare(
          "UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), id).run()
        return json({ status: "failed", error: "No text content to analyze" })
      }

      // Run analysis synchronously in this request
      try {
        const { analysisId } = await runAnalysis(env, id, rawText)
        return json({ status: "complete", analysis_id: analysisId })
      } catch (err) {
        await env.DB.prepare(
          "UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), id).run()
        return json({ status: "failed", error: "Analysis failed: " + String(err) })
      }
    }

    return json({ status: conv.status })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
}

// ── POST — text paste analysis ─────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 503)

  let body
  try { body = await request.json() } catch { return json({ error: "Invalid JSON" }, 400) }

  const { title, raw_text, participants = [], type = "text" } = body
  if (!raw_text?.trim()) return json({ error: "raw_text required" }, 400)

  try {
    const convId = crypto.randomUUID()
    const now = new Date().toISOString()

    await env.DB.prepare(`
      INSERT INTO conversations (id, title, source_type, created_at, updated_at, raw_text, status)
      VALUES (?, ?, ?, ?, ?, ?, 'analyzing')
    `).bind(convId, title || "Untitled Conversation", type === "text" ? "text_paste" : type, now, now, raw_text).run()

    for (let i = 0; i < participants.length; i++) {
      const name = participants[i] || ("Person " + String.fromCharCode(65 + i))
      const colors = ["#8b5cf6", "#ec4899", "#2dd4bf", "#f59e0b"]
      await env.DB.prepare(
        "INSERT INTO participants (id, conversation_id, name, label, color, avatar_initials) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(
        crypto.randomUUID(), convId, name,
        String.fromCharCode(65 + i),
        colors[i % colors.length],
        name.slice(0, 2).toUpperCase()
      ).run()
    }

    // Run analysis synchronously — text is cheap and fast
    const { analysisId } = await runAnalysis(env, convId, raw_text)
    return json({ conversation_id: convId, analysis_id: analysisId, status: "complete" })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
