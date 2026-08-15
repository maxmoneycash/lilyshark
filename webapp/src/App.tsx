import { useState, useEffect } from 'react'
import { backendApi } from './api/backend'
import { MetricsTab } from './components/MetricsTab'
import { ProvidersTab } from './components/ProvidersTab'
import { ActivityTab } from './components/ActivityTab'
import { ShareTab } from './components/ShareTab'
import { MeshTab } from './components/MeshTab'
import { TrafficTab } from './components/TrafficTab'
import { WhitepaperTab } from './components/WhitepaperTab'
import { WalletButton } from './components/WalletButton'

type Tab = 'mesh' | 'traffic' | 'network' | 'providers' | 'activity' | 'whitepaper' | 'share'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'mesh', label: 'Mesh' },
  { id: 'traffic', label: 'Traffic' },
  { id: 'network', label: 'Network' },
  { id: 'providers', label: 'Providers' },
  { id: 'activity', label: 'Activity' },
  { id: 'whitepaper', label: 'Whitepaper' },
  { id: 'share', label: 'Share' },
]

interface NetworkStats {
  totalBlobs: number
  totalStorage: number
  totalStorageFormatted: string
  uploadRate: number
  timestamp: number
}

function App() {
  const [networkStats, setNetworkStats] = useState<NetworkStats | null>(null)
  const [currentTime, setCurrentTime] = useState(new Date())
  // Traffic is the product; it is what the tool is for, so it opens there.
  const [activeTab, setActiveTab] = useState<Tab>('traffic')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchNetworkStats()
    const stats = setInterval(fetchNetworkStats, 15000)
    const clock = setInterval(() => setCurrentTime(new Date()), 30000)
    return () => { clearInterval(stats); clearInterval(clock) }
  }, [])

  async function fetchNetworkStats() {
    try {
      setNetworkStats(await backendApi.getNetworkStats())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach the indexer')
    }
  }

  return (
    <div className="ls-app">
      <header className="ls-header">
        <img className="ls-mark" src="/lilyshark-wordmark-pink.svg" alt="Lilyshark" />

        {/* One line of network truth, always on screen. Values only — the
            labels are short enough to read without a legend. */}
        <div className="ls-live">
          {error ? (
            <span className="bad">indexer unreachable</span>
          ) : networkStats ? (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                <i className="ls-dot" aria-hidden />live
              </span>
              <span><b>{networkStats.totalBlobs.toLocaleString()}</b> blobs</span>
              <span><b>{networkStats.totalStorageFormatted}</b> stored</span>
            </>
          ) : (
            <span className="dim">connecting…</span>
          )}
          <WalletButton variant="header" />
        </div>
      </header>

      <nav className="ls-nav ls-scroll" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            className="ls-tab"
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="ls-main">
        <div className="ls-wrap">
          {activeTab === 'mesh' && <MeshTab />}
          {activeTab === 'traffic' && <TrafficTab />}
          {activeTab === 'network' && <MetricsTab />}
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'activity' && <ActivityTab currentTime={currentTime} />}
          {activeTab === 'whitepaper' && <WhitepaperTab />}
          {activeTab === 'share' && <ShareTab />}
        </div>
      </main>
    </div>
  )
}

export default App
