import { json, options, runAnalysis } from './shared.js'

// POST /api/analyze — analyze text conversation
// GET  /api/analyze?id=uuid — poll status

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

    // Save participants
    for (let i = 0; i < participants.length; i++) {
      const name = participants[i] || `Person ${String.fromCharCode(65 + i)}`
      const colors = ['#8b5cf6','#ec4899','#2dd4bf','#f59e0b']
      await env.DB.prepare(
        "INSERT INTO participants (id, conversation_id, name, label, color, avatar_initials) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(crypto.randomUUID(), convId, name, String.fromCharCode(65 + i), colors[i % colors.length], name.slice(0, 2).toUpperCase()).run()
    }

    // Run analysis in background
    context.waitUntil(runAnalysis(env, convId, raw_text))

    return json({ conversation_id: convId, status: "analyzing" })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestGet(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  const url = new URL(request.url)
  const id  = url.searchParams.get("id")
  if (!id) return json({ error: "id required" }, 400)

  try {
    const conv = await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first()
    if (!conv) return json({ error: "Not found" }, 404)
    if (conv.status !== "complete") return json({ status: conv.status || "processing" })

    const analysis = await env.DB.prepare(
      "SELECT * FROM analysis_runs WHERE conversation_id = ? ORDER BY rowid DESC LIMIT 1"
    ).bind(id).first().catch(() => null)

    if (!analysis) return json({ status: "processing" })

    return json({
      status: "complete",
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
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestOptions() { return options() }
