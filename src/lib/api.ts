const BASE = '/api'

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    throw new Error(`Server error (${res.status}) — unexpected response format`)
  }
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export const api = {
  // Conversations
  listConversations: () => req<{ conversations: any[] }>('/conversations'),
  getConversation:   (id: string) => req<{ conversation: any }>(`/conversations?id=${id}`),
  deleteConversation:(id: string) => req<{ ok: boolean }>(`/conversations?id=${id}`, { method: 'DELETE' }),

  // Analysis
  analyzeText: (payload: { title: string; raw_text: string; participants: string[] }) =>
    req<{ conversation_id: string; status: string }>('/analyze', {
      method: 'POST',
      body: JSON.stringify({ type: 'text', ...payload }),
    }),

  getAnalysisStatus: (id: string) =>
    req<{ status: string; analysis?: any }>(`/analyze?id=${id}`),

  reanalyze: (conversation_id: string) =>
    req<{ ok: boolean; analysis: any }>('/reanalyze', {
      method: 'POST',
      body: JSON.stringify({ conversation_id }),
    }),

  // Upload
  uploadFile: async (file: File, type: 'screenshot' | 'pdf' | 'audio') => {
    const form = new FormData()
    form.append('file', file)
    form.append('type', type)
    const res = await fetch(`${BASE}/upload`, { method: 'POST', body: form })
    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('application/json')) throw new Error(`Upload error (${res.status})`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return data as { upload_id: string; url: string; status: string }
  },

  // Audio streaming URL
  audioUrl: (key: string) => `${BASE}/audio?key=${encodeURIComponent(key)}`,

  // Transcription
  transcribeAudio: async (audio: Blob, title: string, durationSec: number) => {
    const form = new FormData()
    const ext = audio.type.includes('ogg') ? 'ogg' : audio.type.includes('mp4') ? 'mp4' : 'webm'
    form.append('audio', audio, `recording.${ext}`)
    form.append('title', title)
    form.append('duration_sec', String(durationSec))
    const res = await fetch(`${BASE}/transcribe`, { method: 'POST', body: form })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Transcription failed')
    return data as { job_id: string; conversation_id: string }
  },

  getTranscribeStatus: (jobId: string) =>
    req<{ status: string; transcript?: string; utterances?: any[]; speaker_count?: number }>(`/transcribe?job_id=${jobId}`),

  // Search
  search: (query: string) =>
    req<{ results: any[] }>('/search', { method: 'POST', body: JSON.stringify({ query }) }),

  // Coach
  coach: (draft: string, context?: string) =>
    req<{ report: any }>('/coach', { method: 'POST', body: JSON.stringify({ draft, context }) }),

  // Collections
  listCollections:      () => req<{ collections: any[] }>('/collections'),
  getCollection:        (id: string) => req<{ collection: any }>(`/collections?id=${id}`),
  createCollection:     (name: string, description?: string) =>
    req<{ ok: boolean; id: string }>('/collections', { method: 'POST', body: JSON.stringify({ name, description }) }),
  addToCollection:      (collection_id: string, conversation_id: string) =>
    req<{ ok: boolean }>('/collections?action=add', { method: 'POST', body: JSON.stringify({ collection_id, conversation_id }) }),
  removeFromCollection: (collection_id: string, conversation_id: string) =>
    req<{ ok: boolean }>('/collections?action=remove', { method: 'POST', body: JSON.stringify({ collection_id, conversation_id }) }),
  deleteCollection:     (id: string) =>
    req<{ ok: boolean }>(`/collections?id=${id}`, { method: 'DELETE' }),
}

export async function pollAnalysis(
  id: string,
  onStatus?: (s: string) => void,
  max = 30
): Promise<any> {
  for (let i = 0; i < max; i++) {
    await new Promise(r => setTimeout(r, 2000))
    try {
      const r = await api.getAnalysisStatus(id)
      onStatus?.(r.status)
      if (r.status === 'complete') return r.analysis
      if (r.status === 'failed') throw new Error('Analysis failed')
    } catch (e: any) {
      if (i > 8) throw e
    }
  }
  throw new Error('Analysis timed out')
}

export async function pollTranscription(
  jobId: string,
  onStatus?: (s: string) => void,
  max = 60
): Promise<any> {
  for (let i = 0; i < max; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const r = await api.getTranscribeStatus(jobId)
    onStatus?.(r.status)
    if (r.status === 'completed') return r
    if (r.status === 'error' || r.status === 'failed') throw new Error('Transcription failed')
  }
  throw new Error('Transcription timed out')
}
