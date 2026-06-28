// GET /api/audio?key=recordings/xxx.webm — stream audio from R2

const CORS = { "Access-Control-Allow-Origin": "*" }

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const key = url.searchParams.get("key")
  if (!key) return new Response(JSON.stringify({ error: "key required" }), { status: 400, headers: { "Content-Type": "application/json" } })
  if (!env.BLACKBOX_AUDIO) return new Response(JSON.stringify({ error: "BLACKBOX_AUDIO not configured" }), { status: 503, headers: { "Content-Type": "application/json" } })
  try {
    const obj = await env.BLACKBOX_AUDIO.get(key)
    if (!obj) return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: { "Content-Type": "application/json" } })
    return new Response(obj.body, {
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "audio/webm",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      }
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } })
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS })
}
