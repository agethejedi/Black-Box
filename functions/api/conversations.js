// GET /api/conversations       — list conversations
// GET /api/conversations?id=   — get single conversation with utterances + analysis
// POST /api/conversations      — actions (rename_speakers)
// DELETE /api/conversations?id= — delete conversation

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

export async function onRequestGet(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  const url = new URL(request.url)
  const id  = url.searchParams.get("id")
  try {
    if (id) {
      const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first()
      if (!conv) return json({ error: "Not found" }, 404)
      const [participants, utterances, analysis] = await Promise.all([
        env.DB.prepare("SELECT * FROM participants WHERE conversation_id = ? ORDER BY rowid").bind(id).all(),
        env.DB.prepare("SELECT * FROM utterances WHERE conversation_id = ? ORDER BY sequence").bind(id).all(),
        env.DB.prepare("SELECT * FROM analysis_runs WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1").bind(id).first().catch(() => null),
      ])
      return json({
        conversation: {
          ...conv,
          participants: participants.results || [],
          utterances: utterances.results || [],
          analysis: analysis ? {
            ...analysis,
            topics: JSON.parse(analysis.topics || "[]"),
            themes: JSON.parse(analysis.themes || "[]"),
            key_insights: JSON.parse(analysis.key_insights || "[]"),
            coaching_recommendations: JSON.parse(analysis.coaching_recommendations || "[]"),
            horsemen: JSON.parse(analysis.horsemen_data || "{}"),
            repair: JSON.parse(analysis.repair_data || "{}"),
            validation_by_speaker: JSON.parse(analysis.validation_by_speaker || "{}"),
          } : null
        }
      })
    }
    const result = await env.DB.prepare(`
      SELECT c.id, c.title, c.source_type, c.created_at, c.status,
             c.duration_sec, c.audio_key, c.attachment_key,
             ar.quality_score, ar.escalation_score, ar.outcome
      FROM conversations c
      LEFT JOIN analysis_runs ar ON ar.id = c.analysis_id
      ORDER BY c.created_at DESC LIMIT 100
    `).all()
    return json({ conversations: result.results || [] })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)

  let body
  try { body = await request.json() } catch { return json({ error: "Invalid JSON" }, 400) }

  // ── Rename speakers — preserves utterances, timestamps, attribution ──────
  if (body.action === "rename_speakers") {
    const { conversation_id, mapping } = body
    if (!conversation_id || !mapping) {
      return json({ error: "conversation_id and mapping required" }, 400)
    }
    try {
      // Update speaker_name for each label in utterances
      for (const [label, name] of Object.entries(mapping)) {
        if (!name || !label) continue
        await env.DB.prepare(
          "UPDATE utterances SET speaker_name = ? WHERE conversation_id = ? AND speaker_label = ?"
        ).bind(String(name), conversation_id, String(label)).run()
      }

      // Rebuild raw_text from updated utterances
      const utterances = await env.DB.prepare(
        "SELECT speaker_name, content FROM utterances WHERE conversation_id = ? ORDER BY sequence"
      ).bind(conversation_id).all()

      if (utterances.results?.length) {
        const newRawText = utterances.results
          .map(u => `${u.speaker_name}: ${u.content}`)
          .join("\n")
        await env.DB.prepare(
          "UPDATE conversations SET raw_text = ?, updated_at = ? WHERE id = ?"
        ).bind(newRawText, new Date().toISOString(), conversation_id).run()
      }

      return json({ ok: true, conversation_id })
    } catch (err) { return json({ error: String(err) }, 500) }
  }

  return json({ error: "Unknown action" }, 400)
}

export async function onRequestDelete(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  const url = new URL(request.url)
  const id  = url.searchParams.get("id")
  if (!id) return json({ error: "id required" }, 400)
  try {
    await env.DB.prepare("DELETE FROM utterances WHERE conversation_id = ?").bind(id).run()
    await env.DB.prepare("DELETE FROM participants WHERE conversation_id = ?").bind(id).run()
    await env.DB.prepare("DELETE FROM analysis_runs WHERE conversation_id = ?").bind(id).run()
    await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run()
    return json({ ok: true })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
