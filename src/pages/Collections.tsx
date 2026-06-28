import { useState, useEffect } from 'react'
import { Collection } from '../types'
import OutcomeBadge from '../components/OutcomeBadge'
import { api } from '../lib/api'

const TREND_COLOR: Record<string, string> = {
  improving: '#10b981', worsening: '#ef4444', stable: '#9494b8', fluctuating: '#f59e0b'
}
const TREND_ICON: Record<string, string> = {
  improving: '↑', worsening: '↓', stable: '→', fluctuating: '↕'
}

export default function Collections() {
  const [collections, setCollections] = useState<Collection[]>([])
  const [selected, setSelected] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try { const d = await api.listCollections(); setCollections(d.collections || []) } catch {}
  }

  const loadOne = async (id: string) => {
    setLoading(true)
    try { const d = await api.getCollection(id); setSelected(d.collection) }
    catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setLoading(true); setError('')
    try {
      await api.createCollection(newName.trim(), newDesc.trim() || undefined)
      setNewName(''); setNewDesc(''); setCreating(false); await load()
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this collection? Conversations are not deleted.')) return
    try { await api.deleteCollection(id); setSelected(null); await load() } catch {}
  }

  const handleRemove = async (collId: string, convId: string) => {
    try { await api.removeFromCollection(collId, convId); await loadOne(collId); await load() }
    catch (e: any) { setError(e.message) }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Collections</h1>
          <p className="text-sm mt-0.5" style={{ color: '#9494b8' }}>Group conversations for cross-session pattern analysis.</p>
        </div>
        <button onClick={() => setCreating(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: '#8b5cf6', color: 'white' }}>
          + New Collection
        </button>
      </div>

      {creating && (
        <div className="mb-6 rounded-xl p-5 animate-fade-in"
          style={{ background: '#16162a', border: '1px solid rgba(139,92,246,0.3)' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">New Collection</h3>
            <button onClick={() => setCreating(false)} className="text-xs" style={{ color: '#9494b8' }}>✕</button>
          </div>
          <div className="space-y-3">
            <input value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Collection name (e.g. 'Work Conflict', 'Q2 2026')"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
            <input value={newDesc} onChange={e => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#f1f1f5' }} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: '#0f0f1a', border: '1px solid #2a2a45', color: '#9494b8' }}>Cancel</button>
              <button onClick={handleCreate} disabled={!newName.trim() || loading}
                className="px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
                style={{ background: '#8b5cf6', color: 'white' }}>Create</button>
            </div>
          </div>
          {error && <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{error}</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-2">
          {collections.length === 0 ? (
            <div className="rounded-xl p-8 text-center" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
              <div className="text-3xl mb-2">📁</div>
              <p className="text-xs" style={{ color: '#9494b8' }}>No collections yet. Create one and add conversations.</p>
            </div>
          ) : collections.map(c => (
            <div key={c.id} onClick={() => loadOne(c.id)}
              className="rounded-xl p-4 cursor-pointer transition-all"
              style={{ background: '#16162a', border: selected?.id === c.id ? '1px solid #8b5cf6' : '1px solid #2a2a45' }}>
              <div className="flex items-start justify-between mb-1">
                <h3 className="text-sm font-medium text-white">{c.name}</h3>
                {c.escalation_trend && (
                  <span className="text-sm font-bold" style={{ color: TREND_COLOR[c.escalation_trend] || '#9494b8' }}>
                    {TREND_ICON[c.escalation_trend] || '→'}
                  </span>
                )}
              </div>
              {c.description && <p className="text-xs mb-2" style={{ color: '#9494b8' }}>{c.description}</p>}
              <div className="flex items-center gap-3">
                <span className="text-xs" style={{ color: '#4a4a6a' }}>{c.member_count} conversation{c.member_count !== 1 ? 's' : ''}</span>
                {c.quality_score_avg != null && (
                  <span className="text-xs font-medium" style={{ color: '#8b5cf6' }}>
                    Avg {Math.round(c.quality_score_avg)}/100
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="lg:col-span-2">
          {!selected && !loading && (
            <div className="rounded-xl p-10 text-center" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
              <div className="text-3xl mb-3">📊</div>
              <p className="text-sm font-medium text-white mb-1">Select a collection</p>
              <p className="text-xs" style={{ color: '#9494b8' }}>View aggregate analysis and cross-session patterns.</p>
            </div>
          )}
          {loading && (
            <div className="rounded-xl p-10 flex items-center justify-center" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
              <div className="w-6 h-6 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
            </div>
          )}
          {selected && !loading && (
            <div className="space-y-4 animate-fade-in">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-white">{selected.name}</h2>
                  {selected.description && <p className="text-xs mt-0.5" style={{ color: '#9494b8' }}>{selected.description}</p>}
                </div>
                <button onClick={() => handleDelete(selected.id)} className="text-xs px-2 py-1 rounded"
                  style={{ color: 'rgba(239,68,68,0.6)', border: '1px solid rgba(239,68,68,0.2)' }}>Delete</button>
              </div>

              {selected.analysis && (
                <div className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs tracking-widest uppercase" style={{ color: '#9494b8' }}>
                      Aggregate — v{selected.analysis.version} · {selected.analysis.conversation_count} conversations
                    </h3>
                    {selected.analysis.escalation_trend && (
                      <span className="text-xs px-2 py-0.5 rounded-full"
                        style={{ color: TREND_COLOR[selected.analysis.escalation_trend], background: `${TREND_COLOR[selected.analysis.escalation_trend]}15`, border: `1px solid ${TREND_COLOR[selected.analysis.escalation_trend]}44` }}>
                        {selected.analysis.escalation_trend.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[
                      { label: 'Avg Quality',    value: Math.round(selected.analysis.quality_score_avg),    color: '#8b5cf6' },
                      { label: 'Avg Escalation', value: Math.round(selected.analysis.escalation_score_avg), color: '#ef4444' },
                      { label: 'Avg Validation', value: Math.round(selected.analysis.validation_score_avg), color: '#2dd4bf' },
                    ].map(s => (
                      <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: '#1e1e35' }}>
                        <div className="text-2xl font-light mb-0.5" style={{ color: s.color }}>{s.value}</div>
                        <div className="text-[10px]" style={{ color: '#9494b8' }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                  {selected.analysis.recurring_themes?.length > 0 && (
                    <div className="mb-4">
                      <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: '#9494b8' }}>Recurring Themes</p>
                      <div className="flex flex-wrap gap-1.5">
                        {selected.analysis.recurring_themes.map((t: string) => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full"
                            style={{ background: 'rgba(139,92,246,0.1)', color: '#c4b5fd', border: '1px solid rgba(139,92,246,0.2)' }}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {selected.analysis.coaching_recommendations?.length > 0 && (
                    <div className="rounded-lg p-4" style={{ background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
                      <p className="text-[10px] tracking-widest uppercase mb-2" style={{ color: '#8b5cf6' }}>Cross-Session Recommendations</p>
                      <ul className="space-y-1.5">
                        {selected.analysis.coaching_recommendations.map((r: string, i: number) => (
                          <li key={i} className="text-xs flex gap-2" style={{ color: '#c4b5fd' }}>
                            <span style={{ color: '#4a4a6a' }}>·</span>{r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-xl p-4" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
                <h3 className="text-xs tracking-widest uppercase mb-3" style={{ color: '#9494b8' }}>
                  Conversations ({selected.members?.length || 0})
                </h3>
                {!selected.members?.length ? (
                  <p className="text-xs text-center py-4" style={{ color: '#4a4a6a' }}>
                    Add conversations from the Conversations page using the + Collection button.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selected.members.map((m: any) => (
                      <div key={m.conversation_id} className="flex items-center justify-between rounded-lg p-3"
                        style={{ background: '#1e1e35', border: '1px solid #2a2a45' }}>
                        <div>
                          <p className="text-xs font-medium text-white">{m.title}</p>
                          <p className="text-[10px] mt-0.5" style={{ color: '#4a4a6a' }}>
                            {new Date(m.created_at).toLocaleDateString()} · {m.source_type}
                          </p>
                        </div>
                        <button onClick={() => handleRemove(selected.id, m.conversation_id)}
                          className="text-[10px] px-2 py-0.5 rounded"
                          style={{ color: 'rgba(239,68,68,0.5)', border: '1px solid rgba(239,68,68,0.15)' }}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
