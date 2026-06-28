import { json, options, toBase64, safeJson, runAnalysis } from './shared.js'

// POST /api/upload — upload screenshot/pdf/audio to R2 and analyze

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    if (!env.DB) return json({ error: "DB not configured" }, 503)
    if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 503)

    const formData = await request.formData()
    const file = formData.get("file")
    const type = formData.get("type") || "screenshot"
    if (!file) return json({ error: "file required" }, 400)

    const uploadId = crypto.randomUUID()
    const ext = file.name?.split(".").pop()?.toLowerCase() || "bin"
    const key = `${type}/${uploadId}.${ext}`

    const bucket = type === "audio" ? env.BLACKBOX_AUDIO : env.BLACKBOX_UPLOADS
    if (!bucket) return json({ error: `R2 bucket not configured for type: ${type}` }, 503)

    // Buffer once — stream can only be consumed once
    const arrayBuffer = await file.arrayBuffer()
    await bucket.put(key, arrayBuffer.slice(0), {
      httpMetadata: { contentType: file.type || "application/octet-stream" }
    })

    const convId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sourceType = type === "screenshot" ? "screenshot" : type === "audio" ? "audio" : "pdf"

    await env.DB.prepare(`
      INSERT INTO conversations (id, title, source_type, created_at, updated_at, attachment_key, status)
      VALUES (?, ?, ?, ?, ?, ?, 'processing')
    `).bind(convId, file.name || "Uploaded File", sourceType, now, now, key).run()

    // Process in background
    const processFile = async () => {
      try {
        let rawText = ""

        if (sourceType === "screenshot") {
          // Extract text via OpenAI vision
          const mimeType = file.type || "image/jpeg"
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
          if (ct.includes("application/json")) {
            const data = await res.json()
            rawText = data.output?.[0]?.content?.[0]?.text || ""
          }
        }

        if (rawText) {
          await env.DB.prepare("UPDATE conversations SET raw_text = ? WHERE id = ?").bind(rawText, convId).run()
          await runAnalysis(env, convId, rawText)
        } else {
          await env.DB.prepare("UPDATE conversations SET status = 'failed' WHERE id = ?").bind(convId).run()
        }
      } catch (err) {
        console.error("Upload processing error:", String(err))
        await env.DB.prepare("UPDATE conversations SET status = 'failed' WHERE id = ?").bind(convId).run()
      }
    }

    context.waitUntil(processFile())
    return json({ upload_id: convId, status: "processing" })
  } catch (err) {
    return json({ error: "Upload failed", detail: String(err) }, 500)
  }
}

export async function onRequestOptions() { return options() }
