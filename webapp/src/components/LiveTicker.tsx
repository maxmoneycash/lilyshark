import { useState, useEffect } from 'react'
import type { NetworkStats } from '../api/shelby'

interface Props {
  stats: NetworkStats | undefined
}

// Simulate streaming data
interface TickerItem {
  id: string
  type: 'upload' | 'download' | 'expire'
  owner: string
  name: string
  size: string
  timestamp: number
}

export default function LiveTicker({ stats }: Props) {
  const [items, setItems] = useState<TickerItem[]>([])

  // Simulate new items appearing
  useEffect(() => {
    const interval = setInterval(() => {
      const newItem: TickerItem = {
        id: Math.random().toString(),
        type: ['upload', 'download', 'expire'][Math.floor(Math.random() * 3)] as any,
        owner: `0x${Math.random().toString(16).slice(2, 6)}...${Math.random().toString(16).slice(2, 7)}`,
        name: ['image.jpg', 'data.json', 'metadata.txt', 'video.mp4', 'config.yaml'][Math.floor(Math.random() * 5)],
        size: ['2 KB', '156 KB', '1.2 MB', '450 KB', '89 KB'][Math.floor(Math.random() * 5)],
        timestamp: Date.now(),
      }

      setItems(prev => [newItem, ...prev].slice(0, 10))
    }, 2000 + Math.random() * 2000) // Random interval 2-4s

    return () => clearInterval(interval)
  }, [])

  const getIcon = (type: string) => {
    switch (type) {
      case 'upload': return '↑'
      case 'download': return '↓'
      case 'expire': return '⏱'
      default: return '·'
    }
  }

  const getBadgeVariant = (type: string) => {
    switch (type) {
      case 'upload': return 'lime'
      case 'download': return 'pink'
      case 'expire': return 'orange'
      default: return 'purple'
    }
  }

  return (
    <div
      is-="box"
      box-="square"
      shear-="top"
      style={{
        padding: '2ch',
        background: 'var(--background1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '1lh',
        maxHeight: '45lh',
        overflow: 'hidden'
      }}
    >
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h3 style={{ color: 'var(--purple)', fontSize: '1.2em', margin: 0 }}>
          ┌─ LIVE ACTIVITY ─┐
        </h3>
        <span is-="badge" variant-="lime" className="pulse">
          ● {items.length}
        </span>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1lh',
        overflow: 'auto',
        paddingRight: '1ch'
      }}>
        {items.map((item, index) => (
          <div
            key={item.id}
            style={{
              padding: '1lh 1.5ch',
              background: index === 0 ? 'var(--pink-10)' : 'var(--background0)',
              border: `0.2ch solid ${index === 0 ? 'var(--pink)' : 'var(--box-border-color)'}`,
              transition: 'all 0.3s ease',
              animation: index === 0 ? 'slideIn 0.3s ease' : 'none',
              opacity: Math.max(1 - (index * 0.08), 0.4)
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '1ch',
              marginBottom: '0.5lh'
            }}>
              <span is-="badge" variant-={getBadgeVariant(item.type)} style={{ fontSize: '0.8em' }}>
                {getIcon(item.type)}
              </span>
              <span className="mono" style={{
                fontSize: '0.9em',
                color: 'var(--foreground2)'
              }}>
                {Math.floor((Date.now() - item.timestamp) / 1000)}s ago
              </span>
            </div>

            <div className="mono" style={{
              fontSize: '1em',
              fontWeight: 600,
              color: 'var(--foreground0)',
              marginBottom: '0.5lh'
            }}>
              {item.name}
            </div>

            <div style={{
              display: 'flex',
              gap: '1ch',
              fontSize: '0.9em'
            }}>
              <span className="mono" style={{ color: 'var(--foreground2)' }}>
                {item.owner}
              </span>
              <span className="mono" style={{ color: 'var(--purple)' }}>
                {item.size}
              </span>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="mono" style={{
          textAlign: 'center',
          padding: '4lh 2ch',
          color: 'var(--foreground2)'
        }}>
          Waiting for activity...
        </div>
      )}
    </div>
  )
}
