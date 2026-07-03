// POST /api/transcribe — upload audio to AssemblyAI with diarization
// GET  /api/transcribe?job_id=xxx&conv_id=xxx — poll + trigger analysis when done

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

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

  return analysisId
}

// ── POST — submit audio to AssemblyAI ─────────────────────────────────────
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

    // Save to R2
    const fileId = crypto.randomUUID()
    const ext = audioFile.type?.includes("ogg") ? "ogg" : audioFile.type?.includes("mp4") ? "mp4" : "webm"
    const r2Key = `recordings/${fileId}.${ext}`
    await env.BLACKBOX_AUDIO.put(r2Key, audioBuffer.slice(0), {
      httpMetadata: { contentType: audioFile.type }
    })

    // Upload audio to AssemblyAI
    const uploadRes = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { "authorization": env.ASSEMBLYAI_API_KEY, "content-type": "application/octet-stream" },
      body: audioBuffer
    })
    if (!uploadRes.ok) return json({ error: "AssemblyAI upload failed", detail: await uploadRes.text() }, 502)
    const { upload_url } = await uploadRes.json()

    // Submit transcription job
    const transcriptRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "authorization": env.ASSEMBLYAI_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        audio_url: upload_url,
        speaker_labels: true,
        speakers_expected: 2,
        punctuate: true,
        format_text: true
      })
    })
    if (!transcriptRes.ok) return json({ error: "AssemblyAI submission failed", detail: await transcriptRes.text() }, 502)
    const { id: jobId } = await transcriptRes.json()

    // Save conversation to D1
    const convId = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.prepare(`
      INSERT INTO conversations (id, title, source_type, created_at, updated_at, audio_key, duration_sec, status)
      VALUES (?, ?, 'audio', ?, ?, ?, ?, 'pending')
    `).bind(convId, title, now, now, r2Key, durationSec).run()

    // Store job→conv mapping in KV with 2hr TTL
    if (env.BLACKBOX_KV) {
      await env.BLACKBOX_KV.put(
        `transcribe:${jobId}`,
        JSON.stringify({ convId, title, r2Key, durationSec }),
        { expirationTtl: 7200 }
      )
    }

    return json({ ok: true, job_id: jobId, conversation_id: convId })

  } catch (err) {
    return json({ error: "Transcription failed", detail: String(err) }, 500)
  }
}

// ── GET — poll AssemblyAI, save transcript, trigger analysis when ready ────
export async function onRequestGet(context) {
  const { request, env } = context
  if (!env.ASSEMBLYAI_API_KEY) return json({ error: "ASSEMBLYAI_API_KEY not configured" }, 503)

  const url = new URL(request.url)
  const jobId = url.searchParams.get("job_id")
  const convId = url.searchParams.get("conv_id")
  if (!jobId) return json({ error: "job_id required" }, 400)

  try {
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
      headers: { "authorization": env.ASSEMBLYAI_API_KEY }
    })
    if (!pollRes.ok) return json({ error: "Poll failed" }, 502)
    const transcript = await pollRes.json()

    if (transcript.status === "error") {
      if (convId && env.DB) {
        await env.DB.prepare(
          "UPDATE conversations SET status = 'failed', updated_at = ? WHERE id = ?"
        ).bind(new Date().toISOString(), convId).run()
      }
      return json({ status: "failed", error: transcript.error })
    }

    // Still processing
    if (transcript.status !== "completed") {
      return json({ status: transcript.status })
    }

    // Transcription complete — format utterances
    const utterances = (transcript.utterances || []).map(u => ({
      speaker: "Speaker " + u.speaker,
      text: u.text,
      start_ms: u.start,
      end_ms: u.end,
      confidence: u.confidence,
    }))
    const formattedTranscript = utterances.map(u => `${u.speaker}: ${u.text}`).join("\n")

    // Resolve convId from KV if not passed
    let resolvedConvId = convId
    if (!resolvedConvId && env.BLACKBOX_KV) {
      const stored = await env.BLACKBOX_KV.get(`transcribe:${jobId}`, "json")
      resolvedConvId = stored?.convId || null
    }

    // Save transcript to D1
    if (resolvedConvId && env.DB) {
      await env.DB.prepare(
        "UPDATE conversations SET raw_text = ?, status = 'transcribed', updated_at = ? WHERE id = ?"
      ).bind(formattedTranscript, new Date().toISOString(), resolvedConvId).run()

      // Trigger analysis now — in this request, not waitUntil
      if (env.OPENAI_API_KEY) {
        try {
          await env.DB.prepare(
            "UPDATE conversations SET status = 'analyzing', updated_at = ? WHERE id = ?"
          ).bind(new Date().toISOString(), resolvedConvId).run()

          const analysisId = await runAnalysis(env, resolvedConvId, formattedTranscript)
          return json({
            status: "complete",
            conversation_id: resolvedConvId,
            analysis_id: analysisId,
            transcript: formattedTranscript,
            utterances,
            speaker_count: new Set(utterances.map(u => u.speaker)).size,
          })
        } catch (err) {
          console.error("Analysis after transcription failed:", String(err))
          await env.DB.prepare(
            "UPDATE conversations SET status = 'transcribed', updated_at = ? WHERE id = ?"
          ).bind(new Date().toISOString(), resolvedConvId).run()
          // Return transcribed so frontend can retry via /api/analyze
          return json({
            status: "transcribed",
            conversation_id: resolvedConvId,
            transcript: formattedTranscript,
            utterances,
          })
        }
      }
    }

    return json({
      status: "completed",
      conversation_id: resolvedConvId,
      transcript: formattedTranscript,
      utterances,
      speaker_count: new Set(utterances.map(u => u.speaker)).size,
    })

  } catch (err) {
    return json({ error: String(err) }, 500)
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
