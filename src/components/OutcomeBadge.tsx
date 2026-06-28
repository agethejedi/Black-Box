import { ConflictOutcome } from '../types'
const CFG: Record<ConflictOutcome, { label: string; color: string; bg: string }> = {
  resolved:   { label: 'Resolved',   color: '#10b981', bg: 'rgba(16,185,129,0.1)'  },
  unresolved: { label: 'Unresolved', color: '#ef4444', bg: 'rgba(239,68,68,0.1)'   },
  escalated:  { label: 'Escalated',  color: '#f59e0b', bg: 'rgba(245,158,11,0.1)'  },
  deferred:   { label: 'Deferred',   color: '#9494b8', bg: 'rgba(148,148,184,0.1)' },
}
export default function OutcomeBadge({ outcome }: { outcome: ConflictOutcome }) {
  const c = CFG[outcome] || CFG.unresolved
  return (
    <span className="text-[10px] tracking-wide px-2 py-0.5 rounded-full font-medium"
      style={{ color: c.color, background: c.bg, border: `1px solid ${c.color}44` }}>
      {c.label}
    </span>
  )
}
