import { useEffect, useState, useRef } from 'react'
import { backendApi, type AnalyticsData, type StorageLeader } from '../api/backend'

// Color mapping for file type categories (lowercase to match DB output from getBlobStatsByType)
// These match the SQL CASE statement in db.ts
const categoryColors: Record<string, string> = {
  'image': '#FF69B4',    // Pink - most visually striking
  'json': '#00C896',     // Green - data/config files
  'text': '#4A90E2',     // Blue - readable content
  'document': '#9B59B6', // Purple - PDFs
  'archive': '#E67E22',  // Orange - compressed files
  'video': '#1ABC9C',    // Teal - multimedia
  'audio': '#F39C12',    // Gold - sound files
  'other': '#7F8C8D',    // Gray - unknown types
}

// Animated counter component
function AnimatedCounter({
  value,
  suffix = '',
  decimals = 0,
  color = 'var(--foreground1)'
}: {
  value: number
  suffix?: string
  decimals?: number
  color?: string
}) {
  const [displayValue, setDisplayValue] = useState(0)
  const prevValue = useRef(0)

  useEffect(() => {
    const startValue = prevValue.current
    const endValue = value
    const duration = 1000 // 1 second animation
    const startTime = Date.now()

    const animate = () => {
      const now = Date.now()
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)

      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = startValue + (endValue - startValue) * eased

      setDisplayValue(current)

      if (progress < 1) {
        requestAnimationFrame(animate)
      } else {
        prevValue.current = endValue
      }
    }

    requestAnimationFrame(animate)
  }, [value])

  return (
    <span style={{
      color,
      fontVariantNumeric: 'tabular-nums',
      fontWeight: 700,
      fontSize: '2.5rem',
      lineHeight: 1
    }}>
      {decimals > 0 ? displayValue.toFixed(decimals) : Math.floor(displayValue).toLocaleString()}{suffix}
    </span>
  )
}

// SVG Donut chart - SVG maintains perfect aspect ratio unlike canvas
function DonutChart({
  data,
  size = 150
}: {
  data: Array<{ label: string; value: number; color: string }>
  size?: number
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const total = data.reduce((sum, d) => sum + d.value, 0)
  const centerX = size / 2
  const centerY = size / 2
  const outerRadius = size / 2 - 4
  const innerRadius = outerRadius * 0.6

  // Generate SVG arc paths
  const createArcPath = (startAngle: number, endAngle: number, outer: number, inner: number) => {
    const startOuter = {
      x: centerX + outer * Math.cos(startAngle),
      y: centerY + outer * Math.sin(startAngle)
    }
    const endOuter = {
      x: centerX + outer * Math.cos(endAngle),
      y: centerY + outer * Math.sin(endAngle)
    }
    const startInner = {
      x: centerX + inner * Math.cos(endAngle),
      y: centerY + inner * Math.sin(endAngle)
    }
    const endInner = {
      x: centerX + inner * Math.cos(startAngle),
      y: centerY + inner * Math.sin(startAngle)
    }

    const largeArc = endAngle - startAngle > Math.PI ? 1 : 0

    return `M ${startOuter.x} ${startOuter.y}
            A ${outer} ${outer} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}
            L ${startInner.x} ${startInner.y}
            A ${inner} ${inner} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}
            Z`
  }

  // Build segments
  const segments: Array<{ path: string; color: string; index: number }> = []
  let currentAngle = -Math.PI / 2 // Start from top

  if (total > 0) {
    data.forEach((item, index) => {
      const sliceAngle = (item.value / total) * 2 * Math.PI
      if (sliceAngle > 0.001) { // Skip tiny segments
        const isHovered = hoveredIndex === index
        const r = isHovered ? outerRadius + 3 : outerRadius
        segments.push({
          path: createArcPath(currentAngle, currentAngle + sliceAngle, r, innerRadius),
          color: item.color,
          index
        })
      }
      currentAngle += sliceAngle
    })
  }

  return (
    <div style={{
      width: size,
      height: size,
      flexShrink: 0,
      position: 'relative'
    }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: 'block' }}
      >
        {/* Empty state */}
        {total === 0 && (
          <circle
            cx={centerX}
            cy={centerY}
            r={outerRadius}
            fill="none"
            stroke="#3a3a4a"
            strokeWidth={outerRadius - innerRadius}
          />
        )}

        {/* Segments */}
        {segments.map((seg) => (
          <path
            key={seg.index}
            d={seg.path}
            fill={seg.color}
            opacity={hoveredIndex === seg.index ? 1 : 0.85}
            stroke="#1a1a2e"
            strokeWidth={1}
            style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
            onMouseEnter={() => setHoveredIndex(seg.index)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </svg>

      {/* Center text */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
        pointerEvents: 'none'
      }}>
        {hoveredIndex !== null && data[hoveredIndex] ? (
          <>
            <div style={{
              color: data[hoveredIndex].color,
              fontWeight: 700,
              fontSize: '0.75rem',
              textTransform: 'capitalize'
            }}>
              {data[hoveredIndex].label}
            </div>
            <div style={{ color: 'var(--foreground2)', fontSize: '0.65rem' }}>
              {((data[hoveredIndex].value / total) * 100).toFixed(0)}%
            </div>
          </>
        ) : (
          <>
            <div style={{ color: 'var(--foreground1)', fontWeight: 700, fontSize: '0.8rem' }}>
              {total.toLocaleString()}
            </div>
            <div style={{ color: 'var(--foreground2)', fontSize: '0.55rem' }}>
              files
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Legend for donut chart - compact horizontal bars
function DonutLegend({ data }: { data: Array<{ label: string; value: number; color: string; size: string }> }) {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  const maxValue = Math.max(...data.map(d => d.value), 1)

  return (
    <column gap-="0.4" style={{ flex: 1, minWidth: '180px', maxWidth: '250px' }}>
      {data.map((item) => (
        <row key={item.label} gap-="0.5" align-="center" style={{ height: '24px' }}>
          <div style={{
            width: '10px',
            height: '10px',
            borderRadius: '2px',
            background: item.color,
            flexShrink: 0
          }} />
          <small style={{
            width: '55px',
            flexShrink: 0,
            color: 'var(--foreground1)',
            fontSize: '0.7rem',
            textTransform: 'capitalize'
          }}>
            {item.label}
          </small>
          {/* Progress bar showing relative size */}
          <div style={{
            flex: 1,
            height: '6px',
            background: 'var(--background2)',
            borderRadius: '3px',
            overflow: 'hidden',
            minWidth: '40px'
          }}>
            <div style={{
              width: `${(item.value / maxValue) * 100}%`,
              height: '100%',
              background: item.color,
              borderRadius: '3px',
              transition: 'width 0.3s ease'
            }} />
          </div>
          <small style={{
            color: 'var(--foreground2)',
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.65rem',
            width: '32px',
            textAlign: 'right',
            flexShrink: 0
          }}>
            {total > 0 ? `${((item.value / total) * 100).toFixed(0)}%` : '0%'}
          </small>
        </row>
      ))}
    </column>
  )
}

function StorageLeaderboard({ leaders }: { leaders: StorageLeader[] }) {
  const maxSize = Math.max(...leaders.map(l => l.totalSize), 1)

  return (
    <column gap-="0.5">
      {leaders.slice(0, 10).map((leader, index) => (
        <row key={leader.address} gap-="1" align-="center" style={{ minHeight: '36px' }}>
          <span style={{
            width: '20px',
            flexShrink: 0,
            color: index < 3 ? '#FF69B4' : 'var(--foreground2)',
            fontWeight: index < 3 ? 700 : 400,
            fontSize: '0.75rem'
          }}>
            #{index + 1}
          </span>
          <column style={{ flex: 1, minWidth: 0 }}>
            <row gap-="0.5" align-="center">
              <a
                href={`https://explorer.aptoslabs.com/account/${leader.address}?network=shelbynet`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--foreground1)',
                  textDecoration: 'none',
                  fontFamily: 'monospace',
                  fontSize: '0.75rem'
                }}
              >
                {leader.addressShort}
              </a>
              <span is-="badge" variant-="background2" size-="half" style={{ fontSize: '0.6rem' }}>
                {leader.blobCount} blobs
              </span>
            </row>
            <div style={{
              height: '6px',
              background: 'var(--background2)',
              borderRadius: '3px',
              overflow: 'hidden',
              marginTop: '3px'
            }}>
              <div style={{
                width: `${(leader.totalSize / maxSize) * 100}%`,
                height: '100%',
                background: index < 3 ? '#FF69B4' : '#4A90E2',
                opacity: 0.7,
                transition: 'width 0.5s ease',
                borderRadius: '3px',
              }} />
            </div>
          </column>
          <small style={{
            width: '60px',
            flexShrink: 0,
            textAlign: 'right',
            color: 'var(--foreground1)',
            fontWeight: 600,
            fontVariantNumeric: 'tabular-nums',
            fontSize: '0.7rem'
          }}>
            {leader.totalSizeFormatted}
          </small>
        </row>
      ))}
    </column>
  )
}

export function MetricsTab() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const data = await backendApi.getAnalytics()
        setAnalytics(data)
      } catch (err) {
        // Silently fail - metrics will show without analytics
      } finally {
        setLoading(false)
      }
    }

    fetchAnalytics()
    const interval = setInterval(fetchAnalytics, 2 * 60 * 1000) // Refresh every 2 minutes
    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return (
      <column pad-="2" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
        <row gap-="1" style={{ alignItems: 'center' }}>
          <span is-="spinner" style={{ color: 'var(--accent)' }}></span>
          <h3 style={{ margin: 0 }}>Loading Network Metrics...</h3>
        </row>
      </column>
    )
  }

  if (!analytics) {
    return (
      <column pad-="2" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
        <small style={{ color: 'var(--foreground2)' }}>Failed to load analytics data</small>
      </column>
    )
  }

  // Show syncing state when no data yet
  const isSyncing = analytics.totalBlobs === 0

  // Prepare donut chart data
  const donutData = analytics.fileTypes.map(ft => ({
    label: ft.extension,
    value: ft.count,
    color: categoryColors[ft.extension] || '#7F8C8D',
    size: ft.totalSizeFormatted
  }))

  // Parse storage value for animated counter
  const storageMatch = analytics.totalSizeFormatted.match(/([\d.]+)\s*(\w+)/)
  const storageValue = storageMatch ? parseFloat(storageMatch[1]) : 0
  const storageSuffix = storageMatch ? ` ${storageMatch[2]}` : ''

  return (
    <column gap-="1.5">
      {/* Syncing Banner */}
      {isSyncing && (
        <row box-="round" pad-="1" gap-="1" style={{
          background: 'linear-gradient(90deg, #4A90E2 0%, #9B59B6 100%)',
          alignItems: 'center'
        }}>
          <span is-="spinner" style={{ color: 'white' }}></span>
          <column style={{ flex: 1 }}>
            <strong style={{ color: 'white', fontSize: '0.85rem' }}>
              Syncing blob data...
            </strong>
            <small style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.7rem' }}>
              Data is being synced from the blockchain. This may take a few minutes.
              {/* Tip: Add APTOS_API_KEY to .env for faster syncing */}
            </small>
          </column>
        </row>
      )}

      {/* Hero Section - Big Numbers */}
      <row gap-="1" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        marginBottom: '0.5rem'
      }}>
        <column box-="square" pad-="1.5" gap-="0.5" style={{
          background: 'linear-gradient(135deg, var(--background1) 0%, var(--background2) 100%)',
          borderColor: '#FF69B4'
        }}>
          <small style={{
            color: 'var(--foreground2)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}>
            Total Storage
          </small>
          <AnimatedCounter
            value={storageValue}
            suffix={storageSuffix}
            decimals={2}
            color="#FF69B4"
          />
          {analytics.bytesPerHour > 0 && (
            <small style={{ color: 'var(--success)', fontSize: '0.7rem' }}>
              ↑ {analytics.bytesPerHourFormatted}/hour
            </small>
          )}
        </column>

        <column box-="square" pad-="1.5" gap-="0.5" style={{
          background: 'linear-gradient(135deg, var(--background1) 0%, var(--background2) 100%)',
          borderColor: '#4A90E2'
        }}>
          <small style={{
            color: 'var(--foreground2)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}>
            Total Blobs
          </small>
          <AnimatedCounter
            value={analytics.totalBlobs}
            color="#4A90E2"
          />
          {analytics.blobsPerHour > 0 && (
            <small style={{ color: 'var(--success)', fontSize: '0.7rem' }}>
              ↑ {analytics.blobsPerHour.toLocaleString()}/hour
            </small>
          )}
        </column>

        <column box-="square" pad-="1.5" gap-="0.5" style={{
          background: 'linear-gradient(135deg, var(--background1) 0%, var(--background2) 100%)',
          borderColor: '#00C896'
        }}>
          <small style={{
            color: 'var(--foreground2)',
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.1em'
          }}>
            Unique Uploaders
          </small>
          <AnimatedCounter
            value={analytics.uniqueOwners}
            color="#00C896"
          />
          <small style={{ color: 'var(--foreground2)', fontSize: '0.7rem' }}>
            Active accounts
          </small>
        </column>
      </row>

      {/* File Types Distribution - Donut Chart + Leaderboard */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '1rem'
      }}>
        {/* Donut Chart Section */}
        <div style={{
          background: 'var(--background1)',
          border: '1px solid var(--background2)',
          borderRadius: '8px',
          padding: '1rem'
        }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <span is-="badge" variant-="pink" cap-="ribbon slant-bottom">Storage by File Type</span>
          </div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem'
          }}>
            <DonutChart data={donutData} size={130} />
            <DonutLegend data={donutData} />
          </div>
        </div>

        {/* Top Storage Users */}
        <div style={{
          background: 'var(--background1)',
          border: '1px solid var(--background2)',
          borderRadius: '8px',
          padding: '1rem'
        }}>
          <div style={{ marginBottom: '0.75rem' }}>
            <span is-="badge" variant-="blue" cap-="ribbon slant-bottom">Top Storage Users</span>
          </div>
          <StorageLeaderboard leaders={analytics.storageLeaders} />
        </div>
      </div>

      {/* Network Stats Footer */}
      <row gap-="1" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        marginTop: '0.5rem'
      }}>
        <column box-="square" pad-="1" gap-="0.25" style={{ textAlign: 'center' }}>
          <small style={{ color: 'var(--foreground2)', fontSize: '0.7rem' }}>File Categories</small>
          <h4 style={{ color: '#9B59B6', margin: 0 }}>{analytics.fileTypes.length}</h4>
        </column>
        <column box-="square" pad-="1" gap-="0.25" style={{ textAlign: 'center' }}>
          <small style={{ color: 'var(--foreground2)', fontSize: '0.7rem' }}>Avg Blob Size</small>
          <h4 style={{ color: '#E67E22', margin: 0 }}>
            {analytics.totalBlobs > 0
              ? formatBytes(analytics.totalSize / analytics.totalBlobs)
              : '0 B'
            }
          </h4>
        </column>
        <column box-="square" pad-="1" gap-="0.25" style={{ textAlign: 'center' }}>
          <small style={{ color: 'var(--foreground2)', fontSize: '0.7rem' }}>Data Updated</small>
          <h4 style={{ color: 'var(--foreground1)', margin: 0, fontSize: '0.9rem' }}>
            {new Date(analytics.timestamp).toLocaleTimeString()}
          </h4>
        </column>
      </row>
    </column>
  )
}

// Helper function for formatting bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}
