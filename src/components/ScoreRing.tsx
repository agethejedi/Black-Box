interface Props { score: number; label: string; color?: string; size?: number }

export default function ScoreRing({ score, label, color = '#8b5cf6', size = 64 }: Props) {
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ

  return (
    <div className="flex flex-col items-center gap-1">
      <div style={{ width: size, height: size, position: 'relative' }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#2a2a45" strokeWidth={4} />
          <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={4}
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-semibold text-white" style={{ fontSize: size * 0.25 }}>{score}%</span>
        </div>
      </div>
      <span className="text-xs" style={{ color: '#9494b8' }}>{label}</span>
    </div>
  )
}
