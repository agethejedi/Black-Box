interface Props {
  name: string
  color?: string
  size?: 'sm' | 'md' | 'lg'
  confidence?: number
  showConfidence?: boolean
}

const COLORS = ['#8b5cf6', '#ec4899', '#2dd4bf', '#f59e0b', '#10b981', '#3b82f6']

export function getInitials(name: string): string {
  return name.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)
}

export function getColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return COLORS[Math.abs(hash) % COLORS.length]
}

export default function SpeakerAvatar({ name, color, size = 'md', confidence, showConfidence = false }: Props) {
  const initials = getInitials(name)
  const bg = color || getColor(name)
  const dim = size === 'sm' ? 28 : size === 'lg' ? 44 : 36

  return (
    <div className="relative flex-shrink-0" style={{ width: dim, height: dim }}>
      <div className="rounded-full flex items-center justify-center font-semibold"
        style={{ width: dim, height: dim, background: `${bg}22`, border: `2px solid ${bg}`, color: bg, fontSize: dim * 0.35 }}>
        {initials}
      </div>
      {showConfidence && confidence != null && (
        <div className="absolute -bottom-1 -right-1 rounded-full text-white flex items-center justify-center"
          style={{ width: 16, height: 16, background: '#10b981', fontSize: 8, fontWeight: 700, border: '1.5px solid #0f0f1a' }}>
          ✓
        </div>
      )}
    </div>
  )
}
