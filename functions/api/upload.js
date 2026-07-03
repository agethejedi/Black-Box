// POST /api/upload — upload file to R2, upload to OpenAI /v1/files, save conversation
// Analysis is NOT triggered here — frontend polls /api/analyze?id=uuid to trigger it

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    if (!env.DB) return json({ error: "DB not configured" }, 503)
    if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY not configured" }, 503)

    const formData = await request.formData()
    const file = formData.get("file")
    const type = formData.get("type") || "screenshot"
    if (!file) return json({ error: "file required" }, 400)

    const arrayBuffer = await file.arrayBuffer()
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return json({ error: "File is empty" }, 400)

    // ── Step 1: Save to R2 ────────────────────────────────────────────────
    const uploadId = crypto.randomUUID()
    const ext = file.name?.split(".").pop()?.toLowerCase() || "bin"
    const r2Key = `${type}/${uploadId}.${ext}`
    const bucket = type === "audio" ? env.BLACKBOX_AUDIO : env.BLACKBOX_UPLOADS
    if (!bucket) return json({ error: `R2 bucket not configured for type: ${type}` }, 503)

    await bucket.put(r2Key, arrayBuffer.slice(0), {
      httpMetadata: { contentType: file.type || "application/octet-stream" }
    })

    // ── Step 2: Upload to OpenAI /v1/files (images only) ─────────────────
    let openaiFileId = null
    if (type === "screenshot") {
      const mimeType = file.type || "image/jpeg"
      const safeMime = (mimeType === "image/heic" || mimeType === "image/heif") ? "image/jpeg" : mimeType
      const fileName = file.name || `screenshot.${ext}`

      const oaiForm = new FormData()
      oaiForm.append("purpose", "vision")
      oaiForm.append("file", new Blob([arrayBuffer], { type: safeMime }), fileName)

      const oaiRes = await fetch("https://api.openai.com/v1/files", {
        method: "POST",
        headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}` },
        body: oaiForm,
      })
      const oaiData = await oaiRes.json()
      if (!oaiRes.ok) {
        console.error("OpenAI file upload failed:", JSON.stringify(oaiData))
        // Don't fail the whole upload — fall back to base64 analysis
      } else {
        openaiFileId = oaiData.id
      }
    }

    // ── Step 3: Save conversation to D1 ──────────────────────────────────
    const convId = crypto.randomUUID()
    const now = new Date().toISOString()
    const sourceType = type === "audio" ? "audio" : type === "screenshot" ? "screenshot" : "pdf"

    await env.DB.prepare(`
      INSERT INTO conversations
        (id, title, source_type, created_at, updated_at, attachment_key, openai_file_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      convId,
      file.name || "Uploaded File",
      sourceType,
      now, now,
      r2Key,
      openaiFileId || null
    ).run()

    return json({ conversation_id: convId, status: "pending", openai_file_id: openaiFileId })

  } catch (err) {
    return json({ error: "Upload failed", detail: String(err) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
