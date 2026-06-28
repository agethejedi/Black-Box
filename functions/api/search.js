import { json, options } from './shared.js'

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.DB) return json({ error: "DB not configured" }, 503)
  let body
  try { body = await request.json() } catch { return json({ error: "Invalid JSON" }, 400) }
  const { query } = body
  if (!query) return json({ error: "query required" }, 400)
  try {
    const results = await env.DB.prepare(`
      SELECT id, title, source_type, created_at, status
      FROM conversations
      WHERE title LIKE ? OR raw_text LIKE ?
      ORDER BY created_at DESC LIMIT 20
    `).bind(`%${query}%`, `%${query}%`).all()
    return json({ results: results.results || [] })
  } catch (err) { return json({ error: String(err) }, 500) }
}

export async function onRequestOptions() { return options() }
