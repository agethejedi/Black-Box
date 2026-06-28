import { NavItem } from '../types'

const NAV = [
  { id: 'dashboard'     as NavItem, label: 'Dashboard',     icon: '⬡' },
  { id: 'conversations' as NavItem, label: 'Conversations',  icon: '💬' },
  { id: 'collections'  as NavItem, label: 'Collections',    icon: '📁' },
  { id: 'insights'     as NavItem, label: 'Insights',       icon: '💡' },
  { id: 'patterns'     as NavItem, label: 'Patterns',       icon: '◎' },
  { id: 'goals'        as NavItem, label: 'Goals',          icon: '🎯' },
  { id: 'coaching'     as NavItem, label: 'Coaching',       icon: '⭐' },
  { id: 'settings'     as NavItem, label: 'Settings',       icon: '⚙️' },
]

interface Props { active: NavItem; onNav: (n: NavItem) => void; userName?: string }

export default function Sidebar({ active, onNav, userName = 'Ronald' }: Props) {
  return (
    <aside className="w-56 flex-shrink-0 flex flex-col h-screen"
      style={{ background: '#16162a', borderRight: '1px solid #2a2a45' }}>

      {/* Logo */}
      <div className="px-5 py-5 border-b" style={{ borderColor: '#2a2a45' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #2dd4bf)', color: 'white' }}>
            BB
          </div>
          <div>
            <div className="text-sm font-semibold text-white">Black Box</div>
            <div className="text-[10px]" style={{ color: '#9494b8' }}>Relationship Coach</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {NAV.map(item => {
          const isActive = active === item.id
          return (
            <button key={item.id} onClick={() => onNav(item.id)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 text-sm"
              style={{
                background: isActive ? 'rgba(139,92,246,0.15)' : 'transparent',
                color: isActive ? '#c4b5fd' : '#9494b8',
                fontWeight: isActive ? 500 : 400,
              }}>
              <span className="w-4 text-center text-base">{item.icon}</span>
              <span>{item.label}</span>
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: '#8b5cf6' }} />}
            </button>
          )
        })}
      </nav>

      {/* Today's Insight */}
      <div className="mx-3 mb-3 rounded-xl p-4"
        style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(45,212,191,0.08))', border: '1px solid rgba(139,92,246,0.2)' }}>
        <div className="flex items-center gap-1.5 mb-2">
          <span style={{ color: '#8b5cf6' }}>✦</span>
          <span className="text-xs font-medium" style={{ color: '#c4b5fd' }}>Today's Insight</span>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: '#9494b8' }}>
          Returning to the original topic 23% faster leads to 2.6x higher resolution rate.
        </p>
        <button className="mt-2 text-xs font-medium" style={{ color: '#8b5cf6' }}>
          View all insights →
        </button>
      </div>

      {/* User */}
      <div className="px-3 py-3 border-t flex items-center gap-2.5" style={{ borderColor: '#2a2a45' }}>
        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', color: 'white' }}>
          {userName.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-white truncate">{userName}</div>
          <div className="text-[10px]" style={{ color: '#9494b8' }}>Pro Plan</div>
        </div>
      </div>
    </aside>
  )
}
