// POST /api/analyze/bundle
// Accepts multiple conversation_ids (already uploaded screenshots)
// Extracts text from each in sequence, merges, analyzes as one conversation

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

async function extractTextFromConversation(env, conv) {
  // Use existing raw_text if already extracted
  if (conv.raw_text) return conv.raw_text

  // Use openai_file_id if available
  let imageInput
  if (conv.openai_file_id) {
    imageInput = { type: "input_image", file_id: conv.openai_file_id }
  } else {
    // Fall back to R2
    if (!env.BLACKBOX_UPLOADS) throw new Error("BLACKBOX_UPLOADS not configured")
    const obj = await env.BLACKBOX_UPLOADS.get(conv.attachment_key)
    if (!obj) throw new Error(`File not found in R2: ${conv.attachment_key}`)
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

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 503)

  let body
  try { body = await request.json() } catch { return json({ error: "Invalid JSON" }, 400) }

  const { conversation_ids, title } = body
  if (!conversation_ids?.length) return json({ error: "conversation_ids array required" }, 400)
  if (conversation_ids.length < 2) return json({ error: "Bundle requires at least 2 screenshots" }, 400)
  if (conversation_ids.length > 10) return json({ error: "Maximum 10 screenshots per bundle" }, 400)

  try {
    // Fetch all source conversations
    const conversations = await Promise.all(
      conversation_ids.map(id =>
        env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first()
      )
    )

    const missing = conversations.findIndex(c => !c)
    if (missing !== -1) return json({ error: `Conversation ${conversation_ids[missing]} not found` }, 404)

    // Extract text from each screenshot in order
    const textSegments = []
    for (let i = 0; i < conversations.length; i++) {
      const conv = conversations[i]
      try {
        const text = await extractTextFromConversation(env, conv)
        if (text) {
          textSegments.push(`[Screenshot ${i + 1}]\n${text}`)
          // Save raw_text back to source conversation if not already set
          if (!conv.raw_text && text) {
            await env.DB.prepare(
              "UPDATE conversations SET raw_text = ?, status = 'transcribed', updated_at = ? WHERE id = ?"
            ).bind(text, new Date().toISOString(), conv.id).run()
          }
        }
      } catch (err) {
        console.error(`Failed to extract text from screenshot ${i + 1}:`, String(err))
        textSegments.push(`[Screenshot ${i + 1} — extraction failed]`)
      }
    }

    const combinedText = textSegments.join("\n\n")
    if (!combinedText.trim()) {
      return json({ error: "Could not extract text from any screenshots" }, 422)
    }

    // Create merged conversation record
    const mergedId = crypto.randomUUID()
    const now = new Date().toISOString()
    const mergedTitle = title || `Bundle: ${conversations[0].title || 'Screenshot Conversation'}`

    await env.DB.prepare(`
      INSERT INTO conversations
        (id, title, source_type, created_at, updated_at, raw_text, status, modality)
      VALUES (?, ?, 'screenshot', ?, ?, ?, 'analyzing', 'bundle')
    `).bind(mergedId, mergedTitle, now, now, combinedText).run()

    // Delete the individual source conversations (they were just staging records)
    for (const conv of conversations) {
      await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(conv.id).run()
    }

    // Run analysis on combined transcript
    const { analysisId, analysis } = await runAnalysis(env, mergedId, combinedText)

    return json({
      ok: true,
      conversation_id: mergedId,
      status: "complete",
      screenshot_count: conversations.length,
      analysis_id: analysisId,
      analysis: {
        quality_score: analysis.quality_score,
        outcome: analysis.outcome,
        key_insights: analysis.key_insights,
        coaching_recommendations: analysis.coaching_recommendations,
      }
    })

  } catch (err) {
    return json({ error: "Bundle analysis failed", detail: String(err) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
