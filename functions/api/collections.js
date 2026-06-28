// Collections API — fully self-contained

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}
const json = (d, s = 200) => new Response(JSON.stringify(d), {
  status: s, headers: { "Content-Type": "application/json", ...CORS }
})

const COLLECTION_PROMPT = `You are Black Box analyzing a collection of related conversations as a unified relationship pattern.
Return ONLY a valid JSON object:
{
  "quality_score_avg": <0-100>,
  "escalation_score_avg": <0-100>,
  "validation_score_avg": <0-100>,
  "collaboration_score_avg": <0-100>,
  "topic_drift_score_avg": <0-100>,
  "resolution_probability_avg": <0.0-1.0>,
  "escalation_trend": "<improving|worsening|stable|fluctuating>",
  "dominant_outcome": "<resolved|unresolved|escalated|deferred>",
  "recurring_themes": ["<theme>"],
  "recurring_topics": ["<topic>"],
  "horsemen_aggregate": { "criticism": <0-100>, "defensiveness": <0-100>, "contempt": <0-100>, "stonewalling": <0-100>, "trend": "<rising|falling|stable>" },
  "repair_aggregate": { "total_repair_attempts": <number>, "successful_repairs": <number>, "resilience_score": <0-100> },
  "coaching_recommendations": ["<cross-conversation rec>"]
}`

async function runCollectionAnalysis(env, collectionId, conversations, version) {
  try {
    const combined = conversations.map((c, i) =>
      "--- CONVERSATION " + (i+1) + " [" + (c.created_at || "").slice(0,10) + "] ---\n" + (c.raw_text || "[No transcript]")
    ).join("\n\n")
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o", input: COLLECTION_PROMPT + "\n\nConversations:\n" + combined })
    })
    const data = await res.json()
    const text = data.output?.[0]?.content?.[0]?.text || "{}"
    let a = {}
    try { a = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim()) } catch {}
    const analysisId = crypto.randomUUID()
    const now = new Date().toISOString()
    const dates = conversations.map(c => c.created_at).filter(Boolean).sort()
    await env.DB.prepare(`
      INSERT INTO collection_analysis_runs (
        id, collection_id, version,
        quality_score_avg, escalation_score_avg, validation_score_avg,
        collaboration_score_avg, topic_drift_score_avg, resolution_probability_avg,
        escalation_trend, dominant_outcome, recurring_themes, recurring_topics,
        horsemen_aggregate, repair_aggregate, coaching_recommendations,
        conversation_count, date_range_start, date_range_end, created_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'complete')
    `).bind(
      analysisId, collectionId, version,
      a.quality_score_avg||0, a.escalation_score_avg||0, a.validation_score_avg||0,
      a.collaboration_score_avg||0, a.topic_drift_score_avg||0, a.resolution_probability_avg||0,
      a.escalation_trend||"stable", a.dominant_outcome||"unresolved",
      JSON.stringify(a.recurring_themes||[]), JSON.stringify(a.recurring_topics||[]),
      JSON.stringify(a.horsemen_aggregate||{}), JSON.stringify(a.repair_aggregate||{}),
      JSON.stringify(a.coaching_recommendations||[]),
      conversations.length, dates[0]||now, dates[dates.length-1]||now, now
    ).run()
    await env.DB.prepare("UPDATE collections SET updated_at = ? WHERE id = ?").bind(now, collectionId).run()
  } catch (err) { console.error("Collection analysis error:", String(err)) }
}

export async function onRequestGet(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  const url = new URL(request.url)
  const id  = url.searchParams.get("id")
  try {
    if (id) {
      const collection = await env.DB.prepare("SELECT * FROM collections WHERE id = ?").bind(id).first()
      if (!collection) return json({ error: "Not found" }, 404)
      const [members, analysis] = await Promise.all([
        env.DB.prepare(`
          SELECT cm.id, cm.conversation_id, cm.added_at, c.title, c.source_type, c.created_at, c.status
          FROM collection_members cm JOIN conversations c ON cm.conversation_id = c.id
          WHERE cm.collection_id = ? ORDER BY c.created_at ASC
        `).bind(id).all(),
        env.DB.prepare("SELECT * FROM collection_analysis_runs WHERE collection_id = ? ORDER BY version DESC LIMIT 1")
          .bind(id).first().catch(() => null)
      ])
      return json({
        collection: {
          ...collection,
          members: members.results || [],
          analysis: analysis ? {
            ...analysis,
            recurring_themes: JSON.parse(analysis.recurring_themes || "[]"),
            recurring_topics: JSON.parse(analysis.recurring_topics || "[]"),
            horsemen_aggregate: JSON.parse(analysis.horsemen_aggregate || "{}"),
            repair_aggregate: JSON.parse(analysis.repair_aggregate || "{}"),
            coaching_recommendations: JSON.parse(analysis.coaching_recommendations || "[]"),
          } : null
        }
      })
    }
    const result = await env.DB.prepare(`
      SELECT c.*, COUNT(cm.id) as member_count
      FROM collections c LEFT JOIN collection_members cm ON c.id = cm.collection_id
      GROUP BY c.id ORDER BY c.updated_at DESC
    `).all().catch(() => ({ results: [] }))
    return json({ collections: result.results || [] })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  const url = new URL(request.url)
  const action = url.searchParams.get("action")
  let body
  try { body = await request.json() } catch { return json({ error: "Invalid JSON" }, 400) }
  try {
    if (action === "add") {
      const { collection_id, conversation_id } = body
      if (!collection_id || !conversation_id) return json({ error: "collection_id and conversation_id required" }, 400)
      const existing = await env.DB.prepare("SELECT collection_id FROM collection_members WHERE conversation_id = ?")
        .bind(conversation_id).first().catch(() => null)
      if (existing) return json({ error: "Conversation already in a collection", current_collection: existing.collection_id }, 409)
      await env.DB.prepare("INSERT INTO collection_members (id, collection_id, conversation_id) VALUES (?, ?, ?)")
        .bind(crypto.randomUUID(), collection_id, conversation_id).run()
      const members = await env.DB.prepare(`
        SELECT c.raw_text, c.source_type, c.created_at FROM collection_members cm
        JOIN conversations c ON cm.conversation_id = c.id
        WHERE cm.collection_id = ? AND c.raw_text IS NOT NULL
      `).bind(collection_id).all()
      const latest = await env.DB.prepare("SELECT MAX(version) as v FROM collection_analysis_runs WHERE collection_id = ?")
        .bind(collection_id).first().catch(() => ({ v: 0 }))
      const nextVersion = (latest?.v || 0) + 1
      if (members.results?.length && env.OPENAI_API_KEY) {
        context.waitUntil(runCollectionAnalysis(env, collection_id, members.results, nextVersion))
      }
      return json({ ok: true })
    }
    if (action === "remove") {
      const { collection_id, conversation_id } = body
      await env.DB.prepare("DELETE FROM collection_members WHERE collection_id = ? AND conversation_id = ?")
        .bind(collection_id, conversation_id).run()
      return json({ ok: true })
    }
    const { name, description } = body
    if (!name) return json({ error: "name required" }, 400)
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    await env.DB.prepare("INSERT INTO collections (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, description || null, now, now).run()
    return json({ ok: true, id, name })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestDelete(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  const url = new URL(request.url)
  const id  = url.searchParams.get("id")
  if (!id) return json({ error: "id required" }, 400)
  try {
    await env.DB.prepare("DELETE FROM collection_members WHERE collection_id = ?").bind(id).run()
    await env.DB.prepare("DELETE FROM collection_analysis_runs WHERE collection_id = ?").bind(id).run()
    await env.DB.prepare("DELETE FROM collections WHERE id = ?").bind(id).run()
    return json({ ok: true })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
