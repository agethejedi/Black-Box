export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bb: {
          bg:      '#0f0f1a',
          surface: '#16162a',
          card:    '#1e1e35',
          border:  '#2a2a45',
          purple:  '#8b5cf6',
          violet:  '#7c3aed',
          teal:    '#2dd4bf',
          pink:    '#ec4899',
          green:   '#10b981',
          orange:  '#f59e0b',
          red:     '#ef4444',
          text:    '#f1f1f5',
          sub:     '#9494b8',
          muted:   '#4a4a6a',
        }
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'monospace'],
      },
    }
  },
  plugins: [],
}
