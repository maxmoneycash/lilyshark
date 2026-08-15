import { useState, useEffect } from 'react'
import { backendApi } from './api/backend'
import { MetricsTab } from './components/MetricsTab'
import { ProvidersTab } from './components/ProvidersTab'
import { ActivityTab } from './components/ActivityTab'
import { EconomyTab } from './components/EconomyTab'
import { ShareTab } from './components/ShareTab'
import { TrafficTab } from './components/TrafficTab'
import { WalletButton } from './components/WalletButton'

type Tab = 'traffic' | 'activity' | 'metrics' | 'providers' | 'economy' | 'share'

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
  const [activeTab, setActiveTab] = useState<Tab>('activity')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [windowWidth, setWindowWidth] = useState(window.innerWidth)

  useEffect(() => {
    // Initial fetch
    fetchNetworkStats()

    // Poll for updates every 15 seconds (reduced from 5s for better mobile performance)
    const statsInterval = setInterval(() => {
      fetchNetworkStats()
    }, 15000)

    // Update time every 30 seconds instead of every second (huge performance gain!)
    const timeInterval = setInterval(() => {
      setCurrentTime(new Date())
    }, 30000)

    // Window resize listener for responsive design
    const handleResize = () => setWindowWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)

    return () => {
      clearInterval(statsInterval)
      clearInterval(timeInterval)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  async function fetchNetworkStats() {
    try {
      const stats = await backendApi.getNetworkStats()
      setNetworkStats(stats)
      setLastUpdate(new Date())
      setError(null)
      setIsLoading(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
      setIsLoading(false)
    }
  }

  function getTimeSinceUpdate() {
    if (!lastUpdate) return 'never'
    const seconds = Math.floor((Date.now() - lastUpdate.getTime()) / 1000)
    if (seconds < 10) return 'just now'
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  if (isLoading) {
    return (
      <column className="terminal-emulator">
        <column className="terminal" box-="square" pad-="2" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
          <row gap-="1" style={{ alignItems: 'center' }}>
            <span is-="spinner" style={{ color: 'var(--accent)' }}></span>
            <h2 style={{ margin: 0 }}>Loading Network Data...</h2>
          </row>
          <small style={{ color: 'var(--foreground2)', marginTop: '0.5rem' }}>
            Fetching real data from Shelby Protocol via Aptos blockchain
          </small>
        </column>
      </column>
    )
  }

  if (error) {
    return (
      <column className="terminal-emulator">
        <column className="terminal" box-="square" pad-="2">
          <h2 style={{ color: 'var(--error)' }}>Failed to Connect to Shelby Protocol</h2>
          <small style={{ color: 'var(--foreground2)' }}>{error}</small>
          <small style={{ color: 'var(--foreground2)', marginTop: '1rem' }}>
            Make sure the pulse-api service is running:
          </small>
          <pre is-="pre" size-="half" style={{ marginTop: '0.5rem' }}>
            cd services/pulse-api{'\n'}
            pnpm dev
          </pre>
          <button
            is-="button"
            variant-="accent"
            size-="half"
            onClick={fetchNetworkStats}
            style={{ marginTop: '1rem' }}
          >
            Retry Connection
          </button>
        </column>
      </column>
    )
  }

  if (!networkStats) {
    return null
  }

  return (
    <column className="terminal-emulator">
      <column className="terminal">
        {/* Terminal Header */}
        <row className="terminal-header">
          <row gap-="1" style={{ padding: '0 1rem' }}>
            <span className="dot-red">●</span>
            <span className="dot-yellow">●</span>
            <span className="dot-green">●</span>
          </row>
          <row style={{ gap: '0.5rem', alignItems: 'center' }}>
            {windowWidth >= 768 && <span is-="badge" variant-="root">Lilyshark</span>}
            {/* Wallet Button - Desktop only (in header) */}
            {windowWidth >= 768 && <WalletButton variant="header" />}
          </row>
          <row className="tab-nav">
            <button
              onClick={() => setActiveTab('traffic')}
              className={activeTab === 'traffic' ? 'active' : ''}
            >
              Traffic
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={activeTab === 'activity' ? 'active' : ''}
            >
              Activity
            </button>
            <button
              onClick={() => setActiveTab('economy')}
              className={activeTab === 'economy' ? 'active' : ''}
            >
              ShelbyUSD
            </button>
            <button
              onClick={() => setActiveTab('metrics')}
              className={activeTab === 'metrics' ? 'active' : ''}
            >
              Metrics
            </button>
            <button
              onClick={() => setActiveTab('providers')}
              className={activeTab === 'providers' ? 'active' : ''}
            >
              Providers
            </button>
            <button
              onClick={() => setActiveTab('share')}
              className={activeTab === 'share' ? 'active' : ''}
            >
              Share
            </button>
            {/* Wallet Button - Mobile only (as tab) */}
            {windowWidth < 768 && <WalletButton variant="tab" />}
          </row>
        </row>

        {/* Status Bar */}
        <row
          style={{
            padding: '0.5rem 1rem',
            background: 'var(--background0)',
            borderBottom: '1px solid var(--background2)',
            gap: '1rem',
            fontSize: '0.85rem',
            flexWrap: 'wrap'
          }}
        >
          <span is-="badge" variant-="success">● LIVE</span>
          <span style={{ color: 'var(--foreground2)' }}>
            Storage: {networkStats.totalStorageFormatted}
          </span>
          <span style={{ color: 'var(--foreground2)' }}>|</span>
          <span style={{ color: 'var(--foreground2)' }}>
            Upload: {networkStats.uploadRate.toFixed(1)} KB/s
          </span>
          <span style={{ color: 'var(--foreground2)' }}>|</span>
          <span style={{ color: 'var(--foreground2)' }}>
            {networkStats.totalBlobs} blobs
          </span>
          <span style={{ color: 'var(--foreground2)' }}>|</span>
          <span style={{ color: 'var(--foreground2)' }}>
            {getTimeSinceUpdate()}
          </span>
        </row>

        {/* Content - GPU accelerated */}
        <column
          className="terminal-content"
          pad-="1"
          style={{
            transform: 'translateZ(0)',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
            position: 'relative'
          }}
        >
          {activeTab === 'traffic' && <TrafficTab />}
          {activeTab === 'activity' && <ActivityTab currentTime={currentTime} />}
          {activeTab === 'economy' && <EconomyTab />}
          {activeTab === 'metrics' && <MetricsTab />}
          {activeTab === 'providers' && <ProvidersTab />}
          {activeTab === 'share' && <ShareTab />}
        </column>
      </column>
    </column>
  )
}

export default App
