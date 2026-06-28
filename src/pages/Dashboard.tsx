import { NavItem } from '../types'

interface Props { onNav: (n: NavItem) => void }

const QUICK = [
  { label: 'Upload / Record', icon: '🎙', nav: 'conversations' as NavItem, color: '#8b5cf6' },
  { label: 'Analyze Text',    icon: '📝', nav: 'conversations' as NavItem, color: '#2dd4bf' },
  { label: 'Coach Mode',      icon: '⭐', nav: 'coaching'      as NavItem, color: '#ec4899' },
  { label: 'Collections',     icon: '📁', nav: 'collections'   as NavItem, color: '#f59e0b' },
]

export default function Dashboard({ onNav }: Props) {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white mb-1">Good evening, Ronald</h1>
        <p className="text-sm" style={{ color: '#9494b8' }}>Here's your relationship intelligence overview.</p>
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
        {[
          { label: 'Avg Quality Score', value: '—', sub: 'Analyze conversations to see', color: '#8b5cf6' },
          { label: 'Resolution Rate',   value: '—', sub: 'No data yet',                  color: '#10b981' },
          { label: 'Conversations',     value: '0', sub: 'Start by uploading one',        color: '#2dd4bf' },
        ].map(s => (
          <div key={s.label} className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
            <div className="text-3xl font-light mb-1" style={{ color: s.color }}>{s.value}</div>
            <div className="text-sm font-medium text-white mb-0.5">{s.label}</div>
            <div className="text-xs" style={{ color: '#9494b8' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Four Horsemen preview */}
      <div className="rounded-xl p-5" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
        <h2 className="text-sm font-medium text-white mb-4">Four Horsemen Snapshot</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {['Criticism', 'Defensiveness', 'Contempt', 'Stonewalling'].map(h => (
            <div key={h} className="text-center">
              <div className="text-2xl font-light mb-1" style={{ color: '#4a4a6a' }}>—</div>
              <div className="text-xs" style={{ color: '#9494b8' }}>{h}</div>
            </div>
          ))}
        </div>
        <p className="text-xs mt-4 text-center" style={{ color: '#4a4a6a' }}>Analyze a conversation to populate scores</p>
      </div>
    </div>
  )
}
