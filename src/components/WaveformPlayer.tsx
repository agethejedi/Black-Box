import { useState, useRef, useEffect } from 'react'

interface Props {
  audioUrl?: string
  durationSec?: number
  speakerA?: string
  speakerB?: string
  colorA?: string
  colorB?: string
}

function FakeWaveform({ progress, colorA, colorB }: { progress: number; colorA: string; colorB: string }) {
  const bars = 80
  return (
    <div className="flex items-center gap-0.5 h-12 flex-1">
      {Array.from({ length: bars }, (_, i) => {
        const pct = i / bars
        const isPast = pct <= progress
        // Alternate between speaker colors with some randomness based on index
        const isA = Math.sin(i * 0.7) > 0
        const color = isPast ? (isA ? colorA : colorB) : '#2a2a45'
        const height = 20 + Math.abs(Math.sin(i * 0.4) * Math.cos(i * 0.3) * 28)
        return (
          <div key={i} className="rounded-full flex-1 transition-colors duration-100"
            style={{ height: `${height}px`, background: color, minWidth: 2 }} />
        )
      })}
    </div>
  )
}

export default function WaveformPlayer({ audioUrl, durationSec = 0, speakerA = 'A', speakerB = 'B', colorA = '#8b5cf6', colorB = '#ec4899' }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [speed, setSpeed] = useState(1.0)
  const [duration, setDuration] = useState(durationSec)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTime = () => {
      setCurrentTime(audio.currentTime)
      setProgress(audio.duration ? audio.currentTime / audio.duration : 0)
    }
    const onEnd = () => setPlaying(false)
    const onMeta = () => setDuration(audio.duration)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnd)
    audio.addEventListener('loadedmetadata', onMeta)
    return () => { audio.removeEventListener('timeupdate', onTime); audio.removeEventListener('ended', onEnd); audio.removeEventListener('loadedmetadata', onMeta) }
  }, [])

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio || !audioUrl) return
    if (playing) { audio.pause(); setPlaying(false) }
    else { await audio.play(); setPlaying(true) }
  }

  const skip = (sec: number) => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = Math.max(0, Math.min(audio.currentTime + sec, audio.duration || 0))
  }

  const cycleSpeed = () => {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0]
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length]
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  const handleWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = (e.clientX - rect.left) / rect.width
    audio.currentTime = pct * audio.duration
  }

  return (
    <div className="rounded-xl p-4" style={{ background: '#16162a', border: '1px solid #2a2a45' }}>
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}

      {/* Waveform */}
      <div className="cursor-pointer mb-3" onClick={handleWaveClick}>
        <FakeWaveform progress={progress} colorA={colorA} colorB={colorB} />
      </div>

      {/* Time labels */}
      <div className="flex items-center justify-between text-xs mb-3" style={{ color: '#9494b8' }}>
        <span className="font-mono">{fmt(currentTime)}</span>
        <span className="font-mono">{fmt(duration)}</span>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={() => skip(-10)} className="w-8 h-8 flex items-center justify-center rounded-full transition-all hover:bg-white/5"
          style={{ color: '#9494b8' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
            <text x="9" y="16" fontSize="6" fill="currentColor">10</text>
          </svg>
        </button>

        <button onClick={toggle} disabled={!audioUrl}
          className="w-12 h-12 rounded-full flex items-center justify-center transition-all disabled:opacity-30"
          style={{ background: '#8b5cf6' }}>
          {playing
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
          }
        </button>

        <button onClick={() => skip(10)} className="w-8 h-8 flex items-center justify-center rounded-full transition-all hover:bg-white/5"
          style={{ color: '#9494b8' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/>
          </svg>
        </button>

        <button onClick={cycleSpeed} className="px-2 py-1 rounded text-xs font-mono transition-all hover:bg-white/5"
          style={{ color: '#9494b8', border: '1px solid #2a2a45' }}>
          {speed}x
        </button>
      </div>

      {/* Speaker legend */}
      <div className="flex items-center justify-center gap-4 mt-3">
        {[{ name: speakerA, color: colorA }, { name: speakerB, color: colorB }].map(s => (
          <div key={s.name} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
            <span className="text-xs" style={{ color: '#9494b8' }}>{s.name}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: '#4a4a6a' }} />
          <span className="text-xs" style={{ color: '#9494b8' }}>Overlap</span>
        </div>
      </div>
    </div>
  )
}
