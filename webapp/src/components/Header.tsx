import { useState, useEffect } from 'react'
import type { NetworkStats } from '../api/shelby'

interface Props {
  stats: NetworkStats | undefined
}

export default function Header({ stats }: Props) {
  const [time, setTime] = useState(new Date())
  const [logo1Loaded, setLogo1Loaded] = useState(false)
  const [logo2Loaded, setLogo2Loaded] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  const getTimeAgo = () => {
    if (!stats) return '—'
    const seconds = Math.floor((Date.now() - stats.timestamp) / 1000)
    return `${seconds}s`
  }

  return (
    <header style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingBottom: '1lh',
      borderBottom: '0.2ch solid var(--box-border-color)',
      flexWrap: 'wrap',
      gap: '2ch',
      minHeight: '4em' // Ensure minimum height
    }}>
      {/* Logo */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2ch',
        flexWrap: 'wrap'
      }}>
        {/* Try Logo 1 */}
        <div style={{
          padding: '0.5em',
          backgroundColor: 'var(--background)',
          border: '2px solid var(--pink)',
          borderRadius: '0.5em',
          minWidth: '4em',
          minHeight: '4em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {!logo1Loaded && <div style={{ color: 'var(--foreground1)', fontSize: '0.8em' }}>Logo 1</div>}
          <img
            src="/shelby-pulse-logo.png"
            alt="Shelby Pulse Logo 1"
            style={{
              height: '3em',
              width: 'auto',
              objectFit: 'contain',
              display: logo1Loaded ? 'block' : 'none'
            }}
            onLoad={() => setLogo1Loaded(true)}
            onError={() => setLogo1Loaded(false)}
          />
        </div>
        {/* Try Logo 2 */}
        <div style={{
          padding: '0.5em',
          backgroundColor: 'var(--background)',
          border: '2px solid var(--purple)',
          borderRadius: '0.5em',
          minWidth: '4em',
          minHeight: '4em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          {!logo2Loaded && <div style={{ color: 'var(--foreground1)', fontSize: '0.8em' }}>Logo 2</div>}
          <img
            src="/shelby-pulse-logo-2.png"
            alt="Shelby Pulse Logo 2"
            style={{
              height: '3em',
              width: 'auto',
              objectFit: 'contain',
              display: logo2Loaded ? 'block' : 'none'
            }}
            onLoad={() => setLogo2Loaded(true)}
            onError={() => setLogo2Loaded(false)}
          />
        </div>
        <span is-="typography" variant-="h2" style={{
          fontSize: '2em',
          fontWeight: 'bold',
          margin: 0
        }}>
          <span style={{ color: 'var(--pink)' }}>[</span>
          <span style={{ color: 'var(--purple)' }}>SHELBY</span>
          <span style={{ color: 'var(--lilac)' }}>/</span>
          <span style={{ color: 'var(--pink)' }}>PULSE</span>
          <span style={{ color: 'var(--pink)' }}>]</span>
        </span>
        <span is-="badge" variant-="lime" className="pulse">
          ● LIVE
        </span>
      </div>

      {/* Status */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '2ch'
      }}>
        <span className="mono" style={{
          fontSize: '1em',
          color: 'var(--foreground1)'
        }}>
          {time.toLocaleTimeString('en-US', { hour12: false })}
        </span>
        <span is-="badge" variant-="lilac" style={{ fontSize: '0.9em' }}>
          Updated {getTimeAgo()} ago
        </span>
      </div>
    </header>
  )
}
