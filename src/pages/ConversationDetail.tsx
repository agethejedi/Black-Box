import { useState, useEffect, useRef } from 'react'
import { Conversation, Utterance } from '../types'
import SpeakerAvatar, { getColor } from '../components/SpeakerAvatar'
import WaveformPlayer from '../components/WaveformPlayer'
import OutcomeBadge from '../components/OutcomeBadge'
import SparkLine from '../components/SparkLine'
import { api } from '../lib/api'

// Topic keyword categories for inline highlighting
const TOPIC_CATEGORIES: Record<string, string> = {
  budget: 'finance', money: 'finance', account: 'finance', retirement: 'finance',
  insurance: 'finance', expenses: 'finance', rent: 'finance', housing: 'finance',
  health: 'health', medical: 'health', doctor: 'health', therapy: 'health',
  argue: 'conflict', fight: 'conflict', angry: 'conflict', blame: 'conflict',
  fault: 'conflict', never: 'conflict', always: 'conflict',
}

function highlightTopics(text: string, topics: string[]): React.ReactNode {
  if (!topics.length) return text
  const allKeywords = [...topics, ...Object.keys(TOPIC_CATEGORIES)]
  const unique = [...new Set(allKeywords.map(k => k.toLowerCase()))]
  const regex = new RegExp(`\\b(${unique.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi')
  const parts = text.split(regex)
  return parts.map((part, i) => {
    const lower = part.toLowerCase()
    if (unique.includes(lower)) {
      const cat = TOPIC_CATEGORIES[lower] || 'default'
      return <mark key={i} className={`topic-chip ${cat}`}>{part}</mark>
    }
    return part
  })
}

interface AnalysisPanelProps { conv: Conversation }

function AnalysisPanel({ conv }: AnalysisPanelProps) {
  const a = conv.analysis
  const participants = conv.participants
  const pA = participants[0]
  const pB = participants[1]
  const colorA = pA ? getColor(pA.name) : '#8b5cf6'
  const colorB = pB ? getColor(pB.name) : '#ec4899'

  if (!a) {
    return (
      <div className="p-5 text-center">
        <div className="text-3xl mb-3">📊</div>
        <p className="text-sm font-medium text-white mb-1">No analysis yet</p>
        <p className="text-xs" style={{ color: '#9494b8' }}>Click Analyze to run GPT-4o analysis</p>
      </div>
    )
  }

  const validationA = a.validation_by_speaker?.[pA?.label || 'A'] ?? a.validation_score
  const validationB = a.validation_by_speaker?.[pB?.label || 'B'] ?? a.validation_score
  const intA = a.interruption_rate_a ?? 32
  const intB = a.interruption_rate_b ?? 68

  return (
    <div className="p-4 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Analysis Summary</h3>
        <button className="text-xs" style={{ color: '#9494b8' }}>ⓘ</button>
      </div>

      {/* Topic Drift */}
      <div className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
        <div className="text-xs mb-1" style={{ color: '#9494b8' }}>Topic Drift</div>
        <div className="text-2xl font-semibold mb-1" style={{ color: a.topic_drift_score > 60 ? '#f59e0b' : '#10b981' }}>
          {a.topic_drift_score}%
        </div>
        <div className="text-xs font-medium" style={{ color: a.topic_drift_score > 60 ? '#f59e0b' : '#10b981' }}>
          {a.topic_drift_score > 60 ? 'High' : a.topic_drift_score > 30 ? 'Moderate' : 'Low'}
        </div>
      </div>

      {/* Validation per speaker */}
      <div className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
        <div className="text-xs mb-3" style={{ color: '#9494b8' }}>Validation</div>
        <div className="flex items-center justify-between">
          {[
            { name: pA?.name || 'Person A', color: colorA, score: validationA },
            { name: pB?.name || 'Person B', color: colorB, score: validationB },
          ].map(s => (
            <div key={s.name} className="text-center">
              <div className="text-lg font-semibold" style={{ color: s.color }}>
                {(s.score / 10).toFixed(1)}<span className="text-xs">/10</span>
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: '#9494b8' }}>{s.name.split(' ')[0]}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Escalation + Collaboration trend */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Escalation', score: a.escalation_score, color: '#f59e0b', values: [30,45,55,60,a.escalation_score] },
          { label: 'Collaboration', score: a.collaboration_score, color: '#8b5cf6', values: [50,55,45,60,a.collaboration_score] },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-3" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
            <div className="text-xs mb-1" style={{ color: '#9494b8' }}>{s.label}</div>
            <div className="text-base font-semibold mb-1" style={{ color: s.color }}>
              {s.score > 60 ? 'High' : s.score > 30 ? 'Medium' : 'Low'}
            </div>
            <SparkLine values={s.values} color={s.color} height={24} width={80} />
          </div>
        ))}
      </div>

      {/* Interruption Rate */}
      <div className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
        <div className="text-xs mb-3" style={{ color: '#9494b8' }}>Interruption Rate</div>
        {[
          { name: pA?.name?.split(' ')[0] || 'Person A', color: colorA, rate: intA },
          { name: pB?.name?.split(' ')[0] || 'Person B', color: colorB, rate: intB },
        ].map(s => (
          <div key={s.name} className="flex items-center gap-3 mb-2 last:mb-0">
            <div className="w-16 text-xs" style={{ color: s.color }}>{s.name}</div>
            <div className="flex-1 h-1.5 rounded-full" style={{ background: '#2a2a45' }}>
              <div className="h-full rounded-full" style={{ width: `${s.rate}%`, background: s.color }} />
            </div>
            <div className="text-xs font-medium w-8 text-right" style={{ color: s.color }}>{s.rate}%</div>
          </div>
        ))}
      </div>

      {/* Resolution Progress */}
      <div className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs" style={{ color: '#9494b8' }}>Resolution Progress</div>
          <div className="text-base font-semibold text-white">{Math.round(a.resolution_probability * 100)}%</div>
        </div>
        <div className="h-2 rounded-full" style={{ background: '#2a2a45' }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${a.resolution_probability * 100}%`, background: 'linear-gradient(90deg, #8b5cf6, #2dd4bf)' }} />
        </div>
      </div>

      {/* Key Insights */}
      {a.key_insights?.length > 0 && (
        <div className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
          <div className="text-xs mb-3 font-medium" style={{ color: '#9494b8' }}>Key Insights</div>
          <ul className="space-y-2">
            {a.key_insights.slice(0, 4).map((insight: string, i: number) => {
              const colors = ['#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6']
              return (
                <li key={i} className="flex gap-2 text-xs" style={{ color: '#d1d5db' }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5" style={{ background: colors[i % colors.length] }} />
                  {insight}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Coaching Suggestion */}
      {a.coaching_recommendations?.length > 0 && (
        <div className="rounded-xl p-4"
          style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.1), rgba(45,212,191,0.05))', border: '1px solid rgba(139,92,246,0.25)' }}>
          <div className="flex items-center gap-1.5 mb-2">
            <span>⭐</span>
            <div className="text-xs font-semibold text-white">Coaching Suggestion</div>
          </div>
          <p className="text-xs leading-relaxed mb-3" style={{ color: '#c4b5fd' }}>
            {a.coaching_recommendations[0]}
          </p>
          <button className="w-full py-2 rounded-lg text-xs font-medium text-white transition-all hover:opacity-90"
            style={{ background: '#8b5cf6' }}>
            View Coaching Plan →
          </button>
        </div>
      )}

      {/* Participants */}
      <div className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="text-xs font-medium" style={{ color: '#9494b8' }}>Participants</div>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full"
            style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}>
            Verified
          </span>
        </div>
        <div className="flex gap-3">
          {conv.participants.map(p => (
            <div key={p.id} className="flex items-center gap-2">
              <SpeakerAvatar name={p.name} size="sm" showConfidence confidence={95} />
              <div>
                <div className="text-xs font-medium text-white">{p.name}</div>
                <div className="text-[10px]" style={{ color: '#10b981' }}>95% confidence</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

interface Props {
  conversationId: string
  onBack: () => void
}

type Tab = 'transcript' | 'analysis' | 'timeline' | 'coaching'

export default function ConversationDetail({ conversationId, onBack }: Props) {
  const [conv, setConv] = useState<Conversation | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>('transcript')
  const [showAll, setShowAll] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStatus, setAnalyzeStatus] = useState('')
  const [error, setError] = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api.getConversation(conversationId)
      .then(d => setConv(d.conversation))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [conversationId])

  // Poll /api/transcribe until job completes then reload conversation
  const startTranscribePoll = (jobId: string, convId: string) => {
    setAnalyzeStatus('Transcribing audio…')
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/transcribe?job_id=${jobId}&conv_id=${convId}`
        )
        const data = await res.json()

        if (data.status === 'completed' || data.status === 'complete') {
          if (pollRef.current) clearInterval(pollRef.current)
          setAnalyzeStatus('Transcription complete — running analysis…')
          // Reload conversation to get updated data
          const updated = await api.getConversation(convId)
          setConv(updated.conversation)
          setAnalyzing(false)
          setAnalyzeStatus('')
        } else if (data.status === 'failed' || data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current)
          setError(data.error || 'Transcription failed')
          setAnalyzing(false)
          setAnalyzeStatus('')
        } else {
          // Still processing — update status label
          setAnalyzeStatus(`Transcribing… (${data.status})`)
        }
      } catch (e: any) {
        if (pollRef.current) clearInterval(pollRef.current)
        setError(e.message)
        setAnalyzing(false)
        setAnalyzeStatus('')
      }
    }, 4000) // poll every 4 seconds
  }

  const handleAnalyze = async () => {
    if (!conv) return
    setAnalyzing(true)
    setError('')
    setAnalyzeStatus('Submitting…')
    try {
      const r = await api.reanalyze(conversationId)

      // Audio recovery path — backend re-submitted to AssemblyAI
      if (r.status === 'processing' && r.job_id) {
        startTranscribePoll(r.job_id, conversationId)
        return // polling takes over from here
      }

      // Direct completion — analysis came back immediately
      if (r.ok && r.status === 'complete') {
        // Reload full conversation to get analysis + transcript
        const updated = await api.getConversation(conversationId)
        setConv(updated.conversation)
        setAnalyzing(false)
        setAnalyzeStatus('')
        return
      }

      // Legacy path — analysis returned inline
      if (r.ok && r.analysis) {
        setConv(c => c ? { ...c, analysis: r.analysis } : c)
        setAnalyzing(false)
        setAnalyzeStatus('')
        return
      }

      throw new Error(r.error || 'Unknown error')

    } catch (e: any) {
      setError(e.message)
      setAnalyzing(false)
      setAnalyzeStatus('')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
    </div>
  )

  if (!conv) return (
    <div className="p-6 text-center" style={{ color: '#9494b8' }}>
      {error || 'Conversation not found'}
    </div>
  )

  const utterances: Utterance[] = conv.utterances || []
  const SHOW = 8
  const visible = showAll ? utterances : utterances.slice(0, SHOW)
  const pA = conv.participants[0]
  const pB = conv.participants[1]
  const colorA = pA ? getColor(pA.name) : '#8b5cf6'
  const colorB = pB ? getColor(pB.name) : '#ec4899'
  const topics = conv.analysis?.topics || []
  const audioUrl = conv.audio_key ? api.audioUrl(conv.audio_key) : undefined
  const durationSec = conv.duration_sec || 0

  const TABS: { id: Tab; label: string }[] = [
    { id: 'transcript', label: 'Transcript' },
    { id: 'analysis',   label: 'Analysis' },
    { id: 'timeline',   label: 'Timeline' },
    { id: 'coaching',   label: 'Coaching' },
  ]

  const fmtDuration = (s: number) => s > 0 ? `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}` : ''

  const analyzeLabel = analyzing
    ? (analyzeStatus || '⏳ Analyzing…')
    : '↻ Analyze'

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
        style={{ background: '#16162a', borderColor: '#2a2a45' }}>
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-sm transition-all hover:opacity-70" style={{ color: '#9494b8' }}>
            ← Back
          </button>
          <div>
            <h1 className="text-lg font-semibold text-white">{conv.title}</h1>
            <div className="flex items-center gap-3 mt-0.5">
              {conv.created_at && (
                <span className="text-xs flex items-center gap-1" style={{ color: '#9494b8' }}>
                  📅 {new Date(conv.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                </span>
              )}
              {durationSec > 0 && (
                <span className="text-xs flex items-center gap-1" style={{ color: '#9494b8' }}>
                  🕐 {fmtDuration(durationSec)}
                </span>
              )}
              <span className="text-xs flex items-center gap-1 capitalize" style={{ color: '#9494b8' }}>
                👤 {conv.source_type === 'audio' ? 'In Person' : conv.source_type.replace('_', ' ')}
              </span>
              {analyzing && analyzeStatus && (
                <span className="text-xs flex items-center gap-1" style={{ color: '#8b5cf6' }}>
                  ⏳ {analyzeStatus}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleAnalyze} disabled={analyzing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{ background: '#8b5cf6', color: 'white' }}>
            {analyzeLabel}
          </button>
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-all"
            style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#9494b8' }}>
            ↗ Share
          </button>
          {conv.analysis && <OutcomeBadge outcome={conv.analysis.outcome} />}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-0 px-6 border-b flex-shrink-0"
        style={{ background: '#16162a', borderColor: '#2a2a45' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className="px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px"
            style={{
              color: activeTab === tab.id ? '#8b5cf6' : '#9494b8',
              borderColor: activeTab === tab.id ? '#8b5cf6' : 'transparent',
            }}>
            {tab.label}
          </button>
        ))}
        {utterances.length > 0 && (
          <div className="ml-auto">
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition-all mr-2"
              style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#9494b8' }}>
              ⬇ Export Report
            </button>
          </div>
        )}
      </div>

      {/* Main content — 2 column */}
      <div className="flex flex-1 overflow-hidden">
        {/* Center — transcript */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'transcript' && (
            <div className="p-4">
              {/* Speaker filter */}
              {utterances.length > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all"
                    style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#9494b8' }}>
                    👥 Speakers ▾
                  </button>
                  <div className="flex-1 relative">
                    <input placeholder="Search transcript…"
                      className="w-full px-3 py-1.5 rounded-lg text-xs outline-none"
                      style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
                  </div>
                  <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs"
                    style={{ background: '#1e1e35', border: '1px solid #2a2a45', color: '#9494b8' }}>
                    ▼ Filters
                  </button>
                </div>
              )}

              {/* Utterances */}
              {utterances.length === 0 ? (
                <div className="text-center py-16">
                  <div className="text-4xl mb-3">💬</div>
                  <p className="text-sm font-medium text-white mb-1">No transcript available</p>
                  <p className="text-xs" style={{ color: '#9494b8' }}>
                    {conv.raw_text ? 'Click Analyze to extract utterances' : 'Upload audio or paste text to begin'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {visible.map((u, i) => {
                    const isA = u.speaker_label === (pA?.label || 'A') || u.speaker_label === pA?.name
                    const speaker = isA ? pA : pB
                    const name = speaker?.name || u.speaker_label || 'Unknown'
                    const color = isA ? colorA : colorB
                    const fmtTime = (ms: number) => {
                      const s = Math.floor(ms / 1000)
                      return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`
                    }

                    return (
                      <div key={u.id || i} className="flex gap-3 p-3 rounded-xl transition-all hover:bg-white/[0.02] group">
                        <div className="flex-shrink-0">
                          <div className="text-[10px] font-mono mb-1.5 text-center" style={{ color: '#4a4a6a' }}>
                            {fmtTime(u.start_ms || 0)}
                          </div>
                          <SpeakerAvatar name={name} color={color} size="sm" showConfidence confidence={u.confidence} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium" style={{ color }}>
                              {name}
                            </span>
                            {u.confidence != null && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                                {Math.round(u.confidence * 100)}%
                              </span>
                            )}
                          </div>
                          <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>
                            {highlightTopics(u.content, topics)}
                          </p>
                        </div>
                        <div className="opacity-0 group-hover:opacity-100 flex items-start gap-1 flex-shrink-0 transition-opacity">
                          <button className="w-6 h-6 rounded flex items-center justify-center text-xs"
                            style={{ color: '#9494b8' }}>🔖</button>
                          <button className="w-6 h-6 rounded flex items-center justify-center text-xs"
                            style={{ color: '#9494b8' }}>⋯</button>
                        </div>
                      </div>
                    )
                  })}

                  {utterances.length > SHOW && (
                    <button onClick={() => setShowAll(s => !s)}
                      className="w-full py-3 text-sm transition-all rounded-xl mt-2"
                      style={{ color: '#9494b8', background: '#1e1e35', border: '1px solid #2a2a45' }}>
                      {showAll ? '▲ Show less' : `▼ Show more transcript (${utterances.length - SHOW} more)`}
                    </button>
                  )}
                </div>
              )}

              {/* Detected topics */}
              {topics.length > 0 && (
                <div className="mt-6 rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium" style={{ color: '#9494b8' }}>Detected Topics</h3>
                    <button className="text-xs" style={{ color: '#8b5cf6' }}>View all</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {topics.map((t: string, i: number) => (
                      <span key={t} className="px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5"
                        style={{
                          background: i === 0 ? 'rgba(139,92,246,0.2)' : '#1e1e35',
                          color: i === 0 ? '#c4b5fd' : '#9494b8',
                          border: `1px solid ${i === 0 ? 'rgba(139,92,246,0.4)' : '#2a2a45'}`
                        }}>
                        {t}
                        {i === 0 && <span>⭐</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Audio player */}
              {(conv.source_type === 'audio' || audioUrl) && (
                <div className="mt-4">
                  <WaveformPlayer
                    audioUrl={audioUrl}
                    durationSec={durationSec}
                    speakerA={pA?.name || 'Person A'}
                    speakerB={pB?.name || 'Person B'}
                    colorA={colorA}
                    colorB={colorB}
                  />
                </div>
              )}

              {error && <p className="mt-3 text-xs text-center" style={{ color: '#ef4444' }}>{error}</p>}
            </div>
          )}

          {activeTab === 'analysis' && <AnalysisPanel conv={conv} />}

          {activeTab === 'coaching' && (
            <div className="p-6">
              {conv.analysis?.coaching_recommendations?.length ? (
                <div className="space-y-4">
                  <h2 className="text-base font-semibold text-white">Coaching Recommendations</h2>
                  {conv.analysis.coaching_recommendations.map((r: string, i: number) => (
                    <div key={i} className="rounded-xl p-4" style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
                      <div className="flex gap-3">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                          style={{ background: 'rgba(139,92,246,0.2)', color: '#c4b5fd' }}>{i + 1}</div>
                        <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>{r}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-16">
                  <p className="text-sm" style={{ color: '#9494b8' }}>Run analysis to see coaching recommendations</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'timeline' && (
            <div className="p-6 text-center py-16">
              <div className="text-3xl mb-3">📅</div>
              <p className="text-sm font-medium text-white mb-1">Timeline View</p>
              <p className="text-xs" style={{ color: '#9494b8' }}>Coming in next build</p>
            </div>
          )}
        </div>

        {/* Right panel — analysis */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-l" style={{ borderColor: '#2a2a45', background: '#16162a' }}>
          <AnalysisPanel conv={conv} />
        </div>
      </div>
    </div>
  )
}
