import { json, options, toBase64, safeJson, runAnalysis } from './shared.js'

// POST /api/reanalyze — re-run analysis, re-extracts from R2 if needed

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
          headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "gpt-4.5-preview",
            input: [{
              type: "message", role: "user",
              content: [
                { type: "input_image", image_url: { url: `data:${safeMime};base64,${base64}` } },
                { type: "input_text", text: "Extract the conversation text from this screenshot. Format each message as 'Speaker: message text'. If speakers are unclear use 'Person A' and 'Person B'. Return only the conversation text." }
              ]
            }]
          })
        })

        const ct = res.headers.get("content-type") || ""
        if (!ct.includes("application/json")) {
          return json({ error: `OpenAI non-JSON response (${res.status})` }, 502)
        }
        const data = await res.json()
        if (data.error) return json({ error: "OpenAI error: " + data.error.message }, 502)
        rawText = data.output?.[0]?.content?.[0]?.text || ""
        if (!rawText) return json({ error: "OpenAI vision returned empty text" }, 422)

        await env.DB.prepare("UPDATE conversations SET raw_text = ? WHERE id = ?").bind(rawText, conversation_id).run()

      } else if (conv.source_type === "audio") {
        return json({ error: "Audio transcript not available. Re-record through the RECORD button." }, 400)
      } else {
        return json({ error: "No content available to analyze.", detail: `source_type: ${conv.source_type}` }, 400)
      }
    }

    const { analysisId, analysis } = await runAnalysis(env, conversation_id, rawText)

    return json({
      ok: true,
      analysis_id: analysisId,
      conversation_id,
      analysis: {
        id: analysisId,
        quality_score: analysis.quality_score || 0,
        escalation_score: analysis.escalation_score || 0,
        outcome: analysis.outcome || "unresolved",
        key_insights: analysis.key_insights || [],
        coaching_recommendations: analysis.coaching_recommendations || [],
      }
    })
  } catch (err) {
    return json({ error: "Re-analysis failed", detail: String(err) }, 500)
  }
}

export async function onRequestOptions() { return options() }
