import { useState, useEffect } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { NetworkStats } from '../api/shelby'

interface Props {
  stats: NetworkStats | undefined
}

export default function ActivityChart({ stats }: Props) {
  const [data, setData] = useState<Array<{ time: string; blobs: number }>>([])

  // Simulate real-time chart data - reduced frequency for better performance
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date()
      const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })

      setData(prev => {
        const newPoint = {
          time: timeStr,
          blobs: Math.floor(Math.random() * 30) + 70, // Random value between 70-100
        }
        return [...prev.slice(-14), newPoint] // Keep last 15 points (reduced from 20)
      })
    }, 10000) // Update every 10 seconds (reduced from 3s for better performance)

    return () => clearInterval(interval)
  }, [])

  return (
    <column
      box-="square"
      shear-="bottom"
      pad-="2 1"
      gap-="2"
      style={{ background: 'var(--pink-10)' }}
    >
      <row align-="center between" style={{ flexWrap: 'wrap' }}>
        <h3 style={{ color: 'var(--pink)', fontSize: '1.2em', margin: 0 }}>
          ┏━━━━━━━━━━━━━━━━━━━┓<br/>
          ┃ UPLOAD ACTIVITY  ┃<br/>
          ┗━━━━━━━━━━━━━━━━━━━┛
        </h3>
        <span is-="badge" variant-="pink">
          ⏱ Last 60m
        </span>
      </row>

      <div style={{
        height: '20lh',
        width: '100%',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'pan-y',
        WebkitTapHighlightColor: 'transparent',
      }}>
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 0, left: -20, bottom: 5 }}>
              <defs>
                <linearGradient id="colorBlobs" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#FF77C9" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#FFDFEF" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#FFC2E1" opacity={0.3} />
              <XAxis
                dataKey="time"
                stroke="#FF77C9"
                style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}
                tickLine={false}
              />
              <YAxis
                stroke="#FF77C9"
                style={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: '#FCFAF8',
                  border: '2px solid #FF77C9',
                  borderRadius: '4px',
                  padding: '8px 12px',
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: '12px'
                }}
                labelStyle={{ color: '#FF77C9', fontWeight: 600 }}
              />
              <Area
                type="monotone"
                dataKey="blobs"
                stroke="#FF77C9"
                strokeWidth={3}
                fill="url(#colorBlobs)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <column align-="center center" self-="grow" style={{ height: '100%' }}>
            <span className="mono" style={{ color: 'var(--foreground2)' }}>
              ⟳ Building chart...
            </span>
          </column>
        )}
      </div>

      <row gap-="1" style={{
        paddingTop: '1lh',
        borderTop: '0.2ch solid var(--pink)'
      }}>
        <span is-="badge" variant-="lime">
          ▲ Peak: 98
        </span>
        <span is-="badge" variant-="pink">
          ◇ Avg: 82
        </span>
        <span is-="badge" variant-="purple">
          ▼ Min: 65
        </span>
      </row>
    </column>
  )
}
