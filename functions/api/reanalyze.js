// POST /api/reanalyze — reset conversation to pending and trigger fresh analysis
// Works for all source types: screenshot, text_paste, audio

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

async function getOrUploadFileId(env, conv) {
  // Use existing file_id if available
  if (conv.openai_file_id) return conv.openai_file_id

  // No file_id — upload to OpenAI now
  if (!env.BLACKBOX_UPLOADS) throw new Error("BLACKBOX_UPLOADS not configured")
  const obj = await env.BLACKBOX_UPLOADS.get(conv.attachment_key)
  if (!obj) throw new Error("File not found in R2")
  const arrayBuffer = await obj.arrayBuffer()
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("R2 file is empty")

  const mimeType = obj.httpMetadata?.contentType || "image/jpeg"
  const safeMime = (mimeType === "image/heic" || mimeType === "image/heif") ? "image/jpeg" : mimeType
  const fileName = conv.attachment_key?.split("/").pop() || "screenshot.png"

  const oaiForm = new FormData()
  oaiForm.append("purpose", "vision")
  oaiForm.append("file", new Blob([arrayBuffer], { type: safeMime }), fileName)

  const oaiRes = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
    body: oaiForm,
  })
  const oaiData = await oaiRes.json()
  if (!oaiRes.ok) throw new Error(`OpenAI file upload failed: ${oaiData.error?.message || oaiRes.status}`)

  // Save file_id to D1 for future use
  await env.DB.prepare(
    "UPDATE conversations SET openai_file_id = ? WHERE id = ?"
  ).bind(oaiData.id, conv.id).run()

  return oaiData.id
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
    const conv = await env.DB.prepare(
      "SELECT * FROM conversations WHERE id = ?"
    ).bind(conversation_id).first()
    if (!conv) return json({ error: "Conversation not found" }, 404)

    // Mark as analyzing
    await env.DB.prepare(
      "UPDATE conversations SET status = 'analyzing', updated_at = ? WHERE id = ?"
    ).bind(new Date().toISOString(), conversation_id).run()

    let rawText = conv.raw_text || ""

    // ── Audio — must have raw_text (transcript) already ───────────────────
    if (conv.source_type === "audio") {
      if (!rawText) {
        await env.DB.prepare(
          "UPDATE conversations SET status = 'transcribed', updated_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), conversation_id).run()
        return json({
          error: "Audio transcript not available yet. Please wait for transcription to complete.",
          status: "transcribed"
        }, 400)
      }
      const { analysisId, analysis } = await runAnalysis(env, conversation_id, rawText)
      return json({ ok: true, analysis_id: analysisId, conversation_id, status: "complete",
        analysis: { quality_score: analysis.quality_score, outcome: analysis.outcome,
          key_insights: analysis.key_insights, coaching_recommendations: analysis.coaching_recommendations }
      })
    }

    // ── Screenshot — extract text via OpenAI vision ───────────────────────
    if (conv.source_type === "screenshot") {
      if (!rawText) {
        // Upload to OpenAI files if needed, then extract text
        const fileId = await getOrUploadFileId(env, conv)

        const visionRes = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4o",
            input: [{
              type: "message", role: "user",
              content: [
                { type: "input_image", file_id: fileId },
                { type: "input_text", text: "Extract the full conversation text from this screenshot. Format each message as 'Speaker: message'. If speakers are unclear use 'Person A' and 'Person B'. Return only the conversation text, nothing else." }
              ]
            }]
          })
        })
        const vct = visionRes.headers.get("content-type") || ""
        if (!vct.includes("application/json")) {
          await env.DB.prepare("UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), conversation_id).run()
          return json({ error: `Vision API non-JSON (${visionRes.status})` }, 502)
        }
        const visionData = await visionRes.json()
        if (visionData.error) {
          await env.DB.prepare("UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), conversation_id).run()
          return json({ error: `Vision API error: ${visionData.error.message}` }, 502)
        }
        rawText = visionData.output?.[0]?.content?.[0]?.text || ""
        if (!rawText) {
          await env.DB.prepare("UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?")
            .bind(new Date().toISOString(), conversation_id).run()
          return json({ error: "Could not extract text from image" }, 422)
        }
        await env.DB.prepare("UPDATE conversations SET raw_text = ? WHERE id = ?")
          .bind(rawText, conversation_id).run()
      }

      const { analysisId, analysis } = await runAnalysis(env, conversation_id, rawText)
      return json({ ok: true, analysis_id: analysisId, conversation_id, status: "complete",
        analysis: { quality_score: analysis.quality_score, outcome: analysis.outcome,
          key_insights: analysis.key_insights, coaching_recommendations: analysis.coaching_recommendations }
      })
    }

    // ── Text paste — run analysis directly ────────────────────────────────
    if (!rawText) {
      await env.DB.prepare("UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), conversation_id).run()
      return json({ error: "No text content to analyze" }, 400)
    }

    const { analysisId, analysis } = await runAnalysis(env, conversation_id, rawText)
    return json({ ok: true, analysis_id: analysisId, conversation_id, status: "complete",
      analysis: { quality_score: analysis.quality_score, outcome: analysis.outcome,
        key_insights: analysis.key_insights, coaching_recommendations: analysis.coaching_recommendations }
    })

  } catch (err) {
    await env.DB.prepare("UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), conversation_id).run().catch(() => {})
    return json({ error: "Re-analysis failed", detail: String(err) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
