import { useState, useEffect } from 'react'
import { NavItem } from '../types'
import { api } from '../lib/api'

interface Props { onNav: (n: NavItem) => void }

const QUICK = [
  { label: 'Upload / Record', icon: '🎙', nav: 'conversations' as NavItem, color: '#8b5cf6' },
  { label: 'Analyze Text',    icon: '📝', nav: 'conversations' as NavItem, color: '#2dd4bf' },
  { label: 'Coach Mode',      icon: '⭐', nav: 'coaching'      as NavItem, color: '#ec4899' },
  { label: 'Collections',     icon: '📁', nav: 'collections'   as NavItem, color: '#f59e0b' },
]

const HORSEMEN_COLORS: Record<string, string> = {
  Criticism:     '#ef4444',
  Defensiveness: '#f59e0b',
  Contempt:      '#8b5cf6',
  Stonewalling:  '#6b7280',
}

interface DashStats {
  total: number
  avgQuality: number | null
  resolutionRate: number | null
  horsemen: {
    criticism: number | null
    defensiveness: number | null
    contempt: number | null
    stonewalling: number | null
  }
  recentOutcomes: string[]
  topTopics: string[]
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 5)  return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 21) return 'Good evening'
  return 'Good night'
}

export default function Dashboard({ onNav }: Props) {
  const [stats, setStats] = useState<DashStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const { conversations } = await api.listConversations()
        if (!conversations?.length) {
          setStats({
            total: 0, avgQuality: null, resolutionRate: null,
            horsemen: { criticism: null, defensiveness: null, contempt: null, stonewalling: null },
            recentOutcomes: [], topTopics: []
          })
          return
        }

        const analyzed = conversations.filter((c: any) => c.quality_score != null)
        const total = conversations.length

        // Average quality score
        const avgQuality = analyzed.length
          ? Math.round(analyzed.reduce((s: number, c: any) => s + (c.quality_score || 0), 0) / analyzed.length)
          : null

        // Resolution rate
        const resolved = conversations.filter((c: any) => c.outcome === 'resolved').length
        const resolutionRate = total > 0 ? Math.round((resolved / total) * 100) : null

        // Recent outcomes
        const recentOutcomes = conversations
          .slice(0, 5)
          .map((c: any) => c.outcome)
          .filter(Boolean)

        // Fetch horsemen data from recent analyzed conversations
        // Pull detail for up to 5 most recent analyzed conversations
        const recentAnalyzed = analyzed.slice(0, 5)
        let horsemenTotals = { criticism: 0, defensiveness: 0, contempt: 0, stonewalling: 0 }
        let horsemenCount = 0
        let allTopics: string[] = []

        await Promise.all(recentAnalyzed.map(async (c: any) => {
          try {
            const { conversation } = await api.getConversation(c.id)
            const a = conversation?.analysis
            if (!a) return
            if (a.horsemen) {
              horsemenTotals.criticism    += a.horsemen.criticism    || 0
              horsemenTotals.defensiveness += a.horsemen.defensiveness || 0
              horsemenTotals.contempt     += a.horsemen.contempt     || 0
              horsemenTotals.stonewalling += a.horsemen.stonewalling || 0
              horsemenCount++
            }
            if (a.topics?.length) allTopics.push(...a.topics)
          } catch {}
        }))

        // Top topics by frequency
        const topicFreq: Record<string, number> = {}
        allTopics.forEach(t => { topicFreq[t] = (topicFreq[t] || 0) + 1 })
        const topTopics = Object.entries(topicFreq)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([t]) => t)

        setStats({
          total,
          avgQuality,
          resolutionRate,
          horsemen: horsemenCount > 0 ? {
            criticism:     Math.round(horsemenTotals.criticism    / horsemenCount),
            defensiveness: Math.round(horsemenTotals.defensiveness / horsemenCount),
            contempt:      Math.round(horsemenTotals.contempt     / horsemenCount),
            stonewalling:  Math.round(horsemenTotals.stonewalling / horsemenCount),
          } : { criticism: null, defensiveness: null, contempt: null, stonewalling: null },
          recentOutcomes,
          topTopics,
        })
      } catch (e) {
        console.error('Dashboard load error:', e)
        setStats({
          total: 0, avgQuality: null, resolutionRate: null,
          horsemen: { criticism: null, defensiveness: null, contempt: null, stonewalling: null },
          recentOutcomes: [], topTopics: []
        })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const fmt = (v: number | null, suffix = '') =>
    v != null ? `${v}${suffix}` : '—'

  const horsemenEntries = [
    { key: 'criticism',     label: 'Criticism' },
    { key: 'defensiveness', label: 'Defensiveness' },
    { key: 'contempt',      label: 'Contempt' },
    { key: 'stonewalling',  label: 'Stonewalling' },
  ] as const

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">
          {getGreeting()}, Ronald
        </h1>
        <p className="text-sm" style={{ color: '#9494b8' }}>
          {loading
            ? 'Loading your relationship intelligence overview…'
            : stats?.total
              ? `${stats.total} conversation${stats.total !== 1 ? 's' : ''} analyzed`
              : 'Here\'s your relationship intelligence overview.'}
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {QUICK.map(q => (
          <button key={q.label} onClick={() => onNav(q.nav)}
            className="rounded-xl p-4 text-left transition-all hover:scale-[1.02]"
            style={{ background: '#16162a', border: `1px solid ${q.color}33` }}>
            <div className="text-2xl mb-2">{q.icon}</div>
            <div className="text-sm font-medium text-white">{q.label}</div>
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
          {loading
            ? <div className="w-16 h-8 rounded animate-pulse mb-1" style={{ background: '#2a2a45' }} />
            : <div className="text-3xl font-light mb-1" style={{ color: '#8b5cf6' }}>
                {fmt(stats?.avgQuality ?? null)}
              </div>
          }
          <div className="text-sm font-medium text-white mb-0.5">Avg Quality Score</div>
          <div className="text-xs" style={{ color: '#9494b8' }}>
            {stats?.avgQuality != null ? 'Across analyzed conversations' : 'Analyze conversations to see'}
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
          {loading
            ? <div className="w-16 h-8 rounded animate-pulse mb-1" style={{ background: '#2a2a45' }} />
            : <div className="text-3xl font-light mb-1" style={{ color: '#10b981' }}>
                {fmt(stats?.resolutionRate ?? null, '%')}
              </div>
          }
          <div className="text-sm font-medium text-white mb-0.5">Resolution Rate</div>
          <div className="text-xs" style={{ color: '#9494b8' }}>
            {stats?.resolutionRate != null ? 'Conversations resolved' : 'No data yet'}
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
          {loading
            ? <div className="w-16 h-8 rounded animate-pulse mb-1" style={{ background: '#2a2a45' }} />
            : <div className="text-3xl font-light mb-1" style={{ color: '#2dd4bf' }}>
                {stats?.total ?? 0}
              </div>
          }
          <div className="text-sm font-medium text-white mb-0.5">Conversations</div>
          <div className="text-xs" style={{ color: '#9494b8' }}>
            {stats?.total ? 'Total ingested' : 'Start by uploading one'}
          </div>
        </div>
      </div>

      {/* Four Horsemen */}
      <div className="rounded-xl p-5 mb-6" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
        <h2 className="text-sm font-medium text-white mb-4">Four Horsemen Snapshot</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {horsemenEntries.map(({ key, label }) => {
            const val = stats?.horsemen[key] ?? null
            const color = HORSEMEN_COLORS[label]
            return (
              <div key={label} className="text-center">
                {loading
                  ? <div className="w-12 h-8 rounded animate-pulse mx-auto mb-1" style={{ background: '#2a2a45' }} />
                  : <div className="text-2xl font-light mb-1"
                      style={{ color: val != null ? color : '#4a4a6a' }}>
                      {val != null ? val : '—'}
                    </div>
                }
                <div className="text-xs" style={{ color: '#9494b8' }}>{label}</div>
                {val != null && (
                  <div className="mt-1.5 h-1 rounded-full mx-4" style={{ background: '#2a2a45' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${val}%`, background: color }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {!loading && !stats?.horsemen.criticism && (
          <p className="text-xs mt-4 text-center" style={{ color: '#4a4a6a' }}>
            Analyze a conversation to populate scores
          </p>
        )}
      </div>

      {/* Top Topics */}
      {!loading && stats?.topTopics?.length > 0 && (
        <div className="rounded-xl p-5 mb-6" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
          <h2 className="text-sm font-medium text-white mb-3">Recurring Topics</h2>
          <div className="flex flex-wrap gap-2">
            {stats.topTopics.map((t, i) => (
              <span key={t} className="px-3 py-1 rounded-full text-xs font-medium"
                style={{
                  background: i === 0 ? 'rgba(139,92,246,0.2)' : '#1e1e35',
                  color: i === 0 ? '#c4b5fd' : '#9494b8',
                  border: `1px solid ${i === 0 ? 'rgba(139,92,246,0.4)' : '#2a2a45'}`
                }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recent outcome distribution */}
      {!loading && stats?.recentOutcomes?.length > 0 && (
        <div className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
          <h2 className="text-sm font-medium text-white mb-3">Recent Outcomes</h2>
          <div className="flex gap-2 flex-wrap">
            {stats.recentOutcomes.map((o, i) => {
              const colors: Record<string, string> = {
                resolved: '#10b981', unresolved: '#f59e0b',
                escalated: '#ef4444', deferred: '#6b7280'
              }
              return (
                <span key={i} className="px-2.5 py-1 rounded-full text-xs capitalize"
                  style={{
                    background: `${colors[o] || '#6b7280'}22`,
                    color: colors[o] || '#6b7280',
                    border: `1px solid ${colors[o] || '#6b7280'}44`
                  }}>
                  {o}
                </span>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
