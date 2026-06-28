import { useState } from 'react'
import { NavItem } from './types'
import Sidebar from './components/Sidebar'
import Dashboard from './pages/Dashboard'
import ConversationsList from './pages/ConversationsList'
import ConversationDetail from './pages/ConversationDetail'
import Collections from './pages/Collections'
import Insights from './pages/Insights'
import Patterns from './pages/Patterns'
import Goals from './pages/Goals'
import Coaching from './pages/Coaching'
import Settings from './pages/Settings'

export default function App() {
  const [nav, setNav] = useState<NavItem>('dashboard')
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null)

  const handleNav = (n: NavItem) => {
    setNav(n)
    if (n !== 'conversations') setSelectedConvId(null)
  }

  const handleSelectConv = (id: string) => {
    setSelectedConvId(id)
    setNav('conversations')
  }

  const renderContent = () => {
    if (nav === 'conversations' && selectedConvId) {
      return <ConversationDetail conversationId={selectedConvId} onBack={() => setSelectedConvId(null)} />
    }
    switch (nav) {
      case 'dashboard':     return <Dashboard onNav={handleNav} />
      case 'conversations': return <ConversationsList onSelect={handleSelectConv} />
      case 'collections':   return <Collections />
      case 'insights':      return <Insights />
      case 'patterns':      return <Patterns />
      case 'goals':         return <Goals />
      case 'coaching':      return <Coaching />
      case 'settings':      return <Settings />
      default:              return <Dashboard onNav={handleNav} />
    }
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0f0f1a' }}>
      <Sidebar active={nav} onNav={handleNav} />
      <main className="flex-1 overflow-y-auto">
        {renderContent()}
      </main>
    </div>
  )
}
