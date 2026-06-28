// POST /api/transcribe — upload audio to AssemblyAI with diarization
// GET  /api/transcribe?job_id=xxx — poll status

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.ASSEMBLYAI_API_KEY) return json({ error: "ASSEMBLYAI_API_KEY not configured" }, 503)
  if (!env.BLACKBOX_AUDIO) return json({ error: "BLACKBOX_AUDIO not configured" }, 503)
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  try {
    const formData = await request.formData()
    const audioFile = formData.get("audio")
    const title = formData.get("title") || "Recorded Conversation"
    const durationSec = parseInt(formData.get("duration_sec") || "0", 10)
    if (!audioFile) return json({ error: "audio file required" }, 400)
    const audioBuffer = await audioFile.arrayBuffer()
    if (!audioBuffer || audioBuffer.byteLength === 0) return json({ error: "Audio is empty" }, 400)
    const fileId = crypto.randomUUID()
    const ext = audioFile.type.includes("ogg") ? "ogg" : audioFile.type.includes("mp4") ? "mp4" : "webm"
    const r2Key = "recordings/" + fileId + "." + ext
    await env.BLACKBOX_AUDIO.put(r2Key, audioBuffer.slice(0), { httpMetadata: { contentType: audioFile.type } })
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "authorization": env.ASSEMBLYAI_API_KEY, "content-type": "application/octet-stream" },
      body: audioBuffer
    })
    if (!uploadRes.ok) return json({ error: "AssemblyAI upload failed", detail: await uploadRes.text() }, 502)
    const { upload_url } = await uploadRes.json()
    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "authorization": env.ASSEMBLYAI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url, speaker_labels: true, speakers_expected: 2, punctuate: true, format_text: true })
    })
    if (!transcriptRes.ok) return json({ error: "AssemblyAI submission failed", detail: await transcriptRes.text() }, 502)
    const { id: jobId } = await transcriptRes.json()
    const convId = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.prepare(`
      INSERT INTO conversations (id, title, source_type, created_at, updated_at, audio_key, duration_sec, status)
      VALUES (?, ?, 'audio', ?, ?, ?, ?, 'processing')
    `).bind(convId, title, now, now, r2Key, durationSec).run()
    if (env.BLACKBOX_KV) {
      await env.BLACKBOX_KV.put("transcribe:" + jobId, JSON.stringify({ convId, title, r2Key, durationSec }), { expirationTtl: 3600 })
    }
    return json({ ok: true, job_id: jobId, conversation_id: convId })
  } catch (err) { return json({ error: "Transcription failed", detail: String(err) }, 500) }
}

export async function onRequestGet(context) {
  const { request, env } = context
  if (!env.ASSEMBLYAI_API_KEY) return json({ error: "ASSEMBLYAI_API_KEY not configured" }, 503)
  const url = new URL(request.url)
  const jobId = url.searchParams.get("job_id")
  if (!jobId) return json({ error: "job_id required" }, 400)
  try {
    const pollRes = await fetch("https://api.assemblyai.com/v2/transcript/" + jobId, {
      headers: { "authorization": env.ASSEMBLYAI_API_KEY }
    })
    if (!pollRes.ok) return json({ error: "Poll failed" }, 502)
    const transcript = await pollRes.json()
    if (transcript.status === "error") return json({ status: "failed", error: transcript.error })
    if (transcript.status !== "completed") return json({ status: transcript.status })
    const utterances = (transcript.utterances || []).map(u => ({
      speaker: "Speaker " + u.speaker,
      text: u.text, start_ms: u.start, end_ms: u.end, confidence: u.confidence,
    }))
    const formattedTranscript = utterances.map(u => u.speaker + ": " + u.text).join("\n")
    let convId = null
    if (env.BLACKBOX_KV) {
      const stored = await env.BLACKBOX_KV.get("transcribe:" + jobId, "json")
      convId = stored?.convId || null
      if (convId && env.DB) {
        await env.DB.prepare("UPDATE conversations SET raw_text = ?, status = 'transcribed' WHERE id = ?")
          .bind(formattedTranscript, convId).run()
      }
    }
    return json({
      status: "completed", conversation_id: convId,
      transcript: formattedTranscript, utterances,
      speaker_count: new Set(utterances.map(u => u.speaker)).size,
    })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
