import { useState, useEffect, useRef, useCallback } from 'react'
import { Conversation, SourceType } from '../types'
import SpeakerAvatar, { getColor } from '../components/SpeakerAvatar'
import OutcomeBadge from '../components/OutcomeBadge'
import { api, pollAnalysis, pollTranscription } from '../lib/api'

type IngestMode = 'text' | 'screenshot' | 'record' | 'file' | null

const SOURCE_ICON: Record<string, string> = {
  audio: '🎙', screenshot: '🖼', text_paste: '📝', pdf: '📄', note: '📋'
}

// Safe chunked base64 for frontend HEIC conversion
function toBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer)
  let binary = ''
  const CHUNK = 1024
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, bytes.length)
    for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j])
  }
  return btoa(binary)
}

function RecordTimer({ seconds, limit = 1500 }: { seconds: number; limit?: number }) {
  const m = Math.floor(seconds / 60), s = seconds % 60
  const pct = Math.min((seconds / limit) * 100, 100)
  const color = seconds > limit * 0.9 ? '#ef4444' : seconds > limit * 0.8 ? '#f59e0b' : '#2dd4bf'
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="text-4xl font-mono font-light tabular-nums" style={{ color }}>
        {String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
      </div>
      <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: '#2a2a45' }}>
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, background: color }} />
      </div>
      {seconds > limit * 0.8 && (
        <p className="text-xs" style={{ color }}>{seconds > limit * 0.9 ? 'APPROACHING LIMIT' : 'OVER 80%'}</p>
      )}
    </div>
  )
}

interface SpeakerVerifyProps {
  utterances: Array<{ speaker: string; text: string }>
  speakerCount: number
  onConfirm: (mapping: Record<string, string>) => void
  onCancel: () => void
}

function SpeakerVerify({ utterances, speakerCount, onConfirm, onCancel }: SpeakerVerifyProps) {
  const speakers = [...new Set(utterances.map(u => u.speaker))]
  const [names, setNames] = useState<Record<string,string>>(
    Object.fromEntries(speakers.map(s => [s, s]))
  )
  const previews = speakers.reduce((acc, sp) => {
    acc[sp] = utterances.find(u => u.speaker === sp)?.text?.slice(0, 80) || ''
    return acc
  }, {} as Record<string,string>)

  return (
    <div className="rounded-xl p-5 animate-fade-in" style={{ background: '#1e1e35', border: '1px solid rgba(139,92,246,0.3)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-medium text-white">Verify Speakers</h3>
          <p className="text-xs mt-0.5" style={{ color: '#9494b8' }}>
            Black Box detected {speakerCount} speaker{speakerCount !== 1 ? 's' : ''}. Name them or leave as-is.
          </p>
        </div>
        <button onClick={onCancel} className="text-xs" style={{ color: '#9494b8' }}>✕</button>
      </div>
      <div className="space-y-3 mb-5">
        {speakers.map(sp => (
          <div key={sp} className="rounded-lg p-3" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
            <div className="flex items-center gap-3 mb-2">
              <SpeakerAvatar name={names[sp] || sp} size="sm" />
              <input value={names[sp]} onChange={e => setNames(n => ({ ...n, [sp]: e.target.value }))}
                placeholder={sp}
                className="flex-1 rounded px-2 py-1 text-sm outline-none"
                style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
            </div>
            {previews[sp] && (
              <p className="text-xs pl-10 italic" style={{ color: '#4a4a6a' }}>
                "{previews[sp]}{previews[sp].length >= 80 ? '…' : ''}"
              </p>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg text-xs"
          style={{ background: '#16162a', border: '1px solid #2a2a45', color: '#9494b8' }}>Cancel</button>
        <button onClick={() => onConfirm(names)} className="px-4 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: '#8b5cf6', color: 'white' }}>Confirm & Analyze →</button>
      </div>
    </div>
  )
}

interface Props { onSelect: (id: string) => void }

export default function ConversationsList({ onSelect }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [ingestMode, setIngestMode] = useState<IngestMode>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [textTitle, setTextTitle] = useState('')
  const [textParts, setTextParts] = useState('Person A, Person B')
  const [textContent, setTextContent] = useState('')
  const [recordTitle, setRecordTitle] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [recSeconds, setRecSeconds] = useState(0)
  const [pendingUtterances, setPendingUtterances] = useState<any[]|null>(null)
  const [pendingSpeakerCount, setPendingSpeakerCount] = useState(0)
  const [pendingTranscript, setPendingTranscript] = useState('')
  const recRef = useRef<MediaRecorder|null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null)

  const loadConversations = async () => {
    try {
      const d = await api.listConversations()
      setConversations(d.conversations || [])
    } catch {}
  }

  useEffect(() => { loadConversations() }, [])

  const handleTextAnalyze = async () => {
    if (!textContent.trim()) return
    setLoading(true); setError(''); setStatus('Analyzing…')
    try {
      const parts = textParts.split(',').map(s => s.trim()).filter(Boolean)
      const r = await api.analyzeText({ title: textTitle || 'Untitled', raw_text: textContent, participants: parts })
      await pollAnalysis(r.conversation_id, setStatus)
      await loadConversations()
      setIngestMode(null); setTextContent(''); setTextTitle(''); setStatus('')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleImageFile = async (file: File) => {
    setLoading(true); setError(''); setStatus('Preparing image…')
    try {
      let uploadFile = file
      const isHeic = file.type === 'image/heic' || file.type === 'image/heif' ||
        file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif')
      if (isHeic) {
        setStatus('Converting iPhone photo…')
        try {
          const bitmap = await createImageBitmap(file)
          const canvas = document.createElement('canvas')
          canvas.width = bitmap.width; canvas.height = bitmap.height
          canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
          const blob = await new Promise<Blob>((res, rej) =>
            canvas.toBlob(b => b ? res(b) : rej(new Error('Canvas failed')), 'image/jpeg', 0.92))
          uploadFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' })
        } catch {}
      }
      setStatus('Uploading…')
      const up = await api.uploadFile(uploadFile, 'screenshot')
      setStatus('Analyzing screenshot…')
      await pollAnalysis(up.upload_id, setStatus)
      await loadConversations()
      setIngestMode(null); setStatus('')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const startRecording = useCallback(async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus' : 'audio/webm'
      const rec = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      const mime = mimeType
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime })
        if (blob.size === 0) { setError('No audio captured'); setLoading(false); return }
        setStatus('Uploading audio…')
        try {
          const r = await api.transcribeAudio(blob, recordTitle || 'Recorded Conversation', recSeconds)
          setStatus('Transcribing with speaker detection…')
          const result = await pollTranscription(r.job_id, setStatus)
          setStatus('Verify speakers')
          setPendingUtterances(result.utterances)
          setPendingSpeakerCount(result.speaker_count || 2)
          setPendingTranscript(result.transcript)
        } catch (e: any) { setError(e.message); setStatus('') }
        finally { setLoading(false) }
      }
      rec.start(1000)
      recRef.current = rec
      setIsRecording(true); setRecSeconds(0)
      timerRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000)
    } catch (e: any) { setError('Microphone error: ' + e.message) }
  }, [recordTitle, recSeconds])

  const stopRecording = useCallback(() => {
    if (!recRef.current) return
    if (timerRef.current) clearInterval(timerRef.current)
    recRef.current.stream.getTracks().forEach(t => t.stop())
    recRef.current.stop()
    setIsRecording(false); setLoading(true)
  }, [])

  const handleSpeakerConfirm = async (nameMapping: Record<string,string>) => {
    if (!pendingTranscript) return
    setLoading(true); setStatus('Analyzing…'); setPendingUtterances(null)
    let named = pendingTranscript
    Object.entries(nameMapping).forEach(([orig, name]) => {
      named = named.split(orig + ':').join(name + ':')
    })
    try {
      const parts = Object.values(nameMapping).filter(Boolean)
      const r = await api.analyzeText({ title: recordTitle || 'Recorded Conversation', raw_text: named, participants: parts })
      await pollAnalysis(r.conversation_id, setStatus)
      await loadConversations()
      setIngestMode(null); setRecordTitle(''); setRecSeconds(0); setStatus(''); setPendingTranscript('')
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Conversations</h1>
          <p className="text-sm mt-0.5" style={{ color: '#9494b8' }}>Ingest, record, and analyze communication threads.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setIngestMode('record')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ background: '#8b5cf6', color: 'white' }}>
            🎙 Upload / Record
          </button>
          <button onClick={() => setIngestMode('text')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
            style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#9494b8' }}>
            📝 Paste Text
          </button>
          <button onClick={() => setIngestMode('screenshot')}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
            style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#9494b8' }}>
            🖼 Screenshot
          </button>
        </div>
      </div>

      {/* Record panel */}
      {ingestMode === 'record' && (
        <div className="mb-6 rounded-xl p-6 animate-fade-in"
          style={{ background: '#16162a', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Record Conversation</h3>
            <button onClick={() => { setIngestMode(null); if (isRecording) stopRecording() }}
              className="text-xs" style={{ color: '#9494b8' }}>✕ Close</button>
          </div>
          {!isRecording && !loading && !pendingUtterances && (
            <input value={recordTitle} onChange={e => setRecordTitle(e.target.value)}
              placeholder="Conversation title (optional)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none mb-4"
              style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
          )}
          {pendingUtterances && (
            <SpeakerVerify utterances={pendingUtterances} speakerCount={pendingSpeakerCount}
              onConfirm={handleSpeakerConfirm}
              onCancel={() => { setPendingUtterances(null); setStatus(''); setLoading(false) }} />
          )}
          {!pendingUtterances && (
            <div className="flex flex-col items-center gap-5 py-4">
              {isRecording && <RecordTimer seconds={recSeconds} />}
              {(loading || status) && !isRecording && (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-6 h-6 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
                  <p className="text-xs" style={{ color: '#8b5cf6' }}>{status}</p>
                </div>
              )}
              {!loading && !isRecording && !status && (
                <p className="text-xs text-center max-w-xs" style={{ color: '#9494b8' }}>
                  Records the conversation, transcribes with speaker detection, then asks you to verify names before analysis.
                </p>
              )}
              {!loading && (
                <button onClick={isRecording ? stopRecording : startRecording}
                  className="w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200"
                  style={{
                    background: isRecording ? 'rgba(239,68,68,0.15)' : 'rgba(139,92,246,0.15)',
                    border: `2px solid ${isRecording ? '#ef4444' : '#8b5cf6'}`,
                    boxShadow: `0 0 24px ${isRecording ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.3)'}`,
                  }}>
                  {isRecording
                    ? <div className="w-6 h-6 rounded-sm" style={{ background: '#ef4444' }} />
                    : <div className="w-5 h-5 rounded-full" style={{ background: '#8b5cf6' }} />
                  }
                </button>
              )}
              <p className="text-[10px] tracking-widest" style={{ color: '#4a4a6a' }}>
                {isRecording ? 'TAP TO STOP' : loading ? '' : 'TAP TO START'}
              </p>
            </div>
          )}
          {error && <p className="text-xs mt-2 text-center" style={{ color: '#ef4444' }}>{error}</p>}
        </div>
      )}

      {/* Text paste panel */}
      {ingestMode === 'text' && (
        <div className="mb-6 rounded-xl p-5 animate-fade-in"
          style={{ background: '#16162a', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Paste Conversation</h3>
            <button onClick={() => setIngestMode(null)} className="text-xs" style={{ color: '#9494b8' }}>✕</button>
          </div>
          <div className="space-y-3">
            <input value={textTitle} onChange={e => setTextTitle(e.target.value)} placeholder="Title (optional)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
            <input value={textParts} onChange={e => setTextParts(e.target.value)} placeholder="Participants (comma separated)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
            <textarea value={textContent} onChange={e => setTextContent(e.target.value)}
              placeholder="Paste conversation here. Format: Name: message" rows={10} 
              className="w-full rounded-lg px-3 py-2 text-sm outline-none resize-none font-mono"
              style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#f1f1f5', lineHeight: 1.6 }} />
            <div className="flex items-center justify-between">
              <p className="text-xs" style={{ color: '#4a4a6a' }}>GPT-4.5 will normalize and analyze.</p>
              <button onClick={handleTextAnalyze} disabled={loading || !textContent.trim()}
                className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40"
                style={{ background: '#8b5cf6', color: 'white' }}>
                {loading ? status || 'Analyzing…' : 'Analyze →'}
              </button>
            </div>
            {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
          </div>
        </div>
      )}

      {/* Screenshot panel */}
      {ingestMode === 'screenshot' && (
        <div className="mb-6 rounded-xl p-5 animate-fade-in"
          style={{ background: '#16162a', border: '1px solid rgba(45,212,191,0.25)' }}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Upload Screenshot</h3>
              <p className="text-xs mt-0.5" style={{ color: '#9494b8' }}>Paste (Cmd+V) or choose a file.</p>
            </div>
            <button onClick={() => setIngestMode(null)} className="text-xs" style={{ color: '#9494b8' }}>✕</button>
          </div>
          <div tabIndex={0}
            onPaste={async e => {
              const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'))
              if (!item) { setError('No image in clipboard'); return }
              const file = item.getAsFile()
              if (!file) return
              setError('')
              await handleImageFile(file)
            }}
            className="flex flex-col items-center justify-center rounded-xl py-10 outline-none cursor-text mb-3"
            style={{ border: '2px dashed rgba(45,212,191,0.3)', background: '#0f0f1a' }}>
            <span className="text-3xl mb-2">📋</span>
            <span className="text-sm font-medium" style={{ color: '#2dd4bf' }}>Paste screenshot here</span>
            <span className="text-xs mt-1" style={{ color: '#4a4a6a' }}>Cmd+V / Ctrl+V</span>
          </div>
          <label className="flex items-center justify-center rounded-xl py-3 cursor-pointer transition-all"
            style={{ border: '1px dashed #2a2a45' }}>
            <span className="text-xs" style={{ color: '#9494b8' }}>📁 Choose file (PNG, JPG, WEBP, HEIC)</span>
            <input type="file" accept="image/*,.heic,.heif" className="hidden"
              onChange={async e => { const f = e.target.files?.[0]; if (f) await handleImageFile(f) }}
              disabled={loading} />
          </label>
          {loading && (
            <div className="flex items-center gap-2 justify-center mt-3">
              <div className="w-4 h-4 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
              <p className="text-xs" style={{ color: '#2dd4bf' }}>{status}</p>
            </div>
          )}
          {error && <p className="text-xs mt-2 text-center" style={{ color: '#ef4444' }}>{error}</p>}
        </div>
      )}

      {/* Conversation list */}
      {conversations.length === 0 ? (
        <div className="rounded-xl p-12 text-center" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
          <div className="text-4xl mb-3">💬</div>
          <h3 className="text-sm font-semibold text-white mb-1">No conversations yet</h3>
          <p className="text-xs" style={{ color: '#9494b8' }}>Record a live conversation, paste text, or upload a screenshot.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {conversations.map((c: any) => (
            <div key={c.id} onClick={() => onSelect(c.id)}
              className="rounded-xl p-4 cursor-pointer transition-all hover:border-purple-500/30 group"
              style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ background: '#1e1e35' }}>
                  {SOURCE_ICON[c.source_type] || '💬'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-medium text-white truncate">{c.title}</span>
                    {c.outcome && <OutcomeBadge outcome={c.outcome} />}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs" style={{ color: '#9494b8' }}>
                      {new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    {c.duration_sec > 0 && (
                      <span className="text-xs" style={{ color: '#9494b8' }}>
                        {Math.floor(c.duration_sec / 60)}:{String(c.duration_sec % 60).padStart(2,'0')}
                      </span>
                    )}
                    {c.quality_score != null && (
                      <span className="text-xs font-medium" style={{ color: '#8b5cf6' }}>
                        Quality: {c.quality_score}/100
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={async e => {
                    e.stopPropagation()
                    setLoading(true)
                    try { await api.reanalyze(c.id); await loadConversations() }
                    catch (err: any) { setError(err.message) }
                    finally { setLoading(false) }
                  }} className="px-2 py-1 rounded text-xs transition-all"
                    style={{ color: '#2dd4bf', border: '1px solid rgba(45,212,191,0.25)', background: 'rgba(45,212,191,0.06)' }}>
                    ↻ Analyze
                  </button>
                </div>
                <span className="text-sm" style={{ color: '#4a4a6a' }}>→</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
