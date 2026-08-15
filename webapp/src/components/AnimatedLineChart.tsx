import { useEffect, useState } from 'react'

interface DataPoint {
  value: number
  timestamp: number
}

interface AnimatedLineChartProps {
  maxDataPoints?: number
  label: string
  color?: string
  height?: number
}

export function AnimatedLineChart({
  maxDataPoints = 20,
  label,
  color = 'var(--lime)',
  height = 200
}: AnimatedLineChartProps) {
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([])

  useEffect(() => {
    // Initial data - reduced for better performance
    const initial = Array.from({ length: 10 }, (_, i) => ({
      value: Math.random() * 100,
      timestamp: Date.now() - (10 - i) * 5000
    }))
    setDataPoints(initial)

    // Add new data point every 5 seconds (reduced from 1s for better performance)
    const interval = setInterval(() => {
      setDataPoints(prev => {
        const newPoint: DataPoint = {
          value: Math.max(0, Math.min(100, prev[prev.length - 1]?.value + (Math.random() - 0.5) * 30)),
          timestamp: Date.now()
        }
        return [...prev.slice(1), newPoint]
      })
    }, 5000)

    return () => clearInterval(interval)
  }, [maxDataPoints])

  const width = 100 // percentage
  const padding = 10

  // Calculate path
  const points = dataPoints.map((point, index) => {
    const x = (index / (maxDataPoints - 1)) * (width - padding * 2) + padding
    const y = height - (point.value / 100) * (height - padding * 2) - padding
    return `${x},${y}`
  }).join(' ')

  const pathD = `M ${points.split(' ').join(' L ')}`

  return (
    <div
      className="chart-container"
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'pan-y',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(percent => (
          <line
            key={percent}
            x1={padding}
            x2={width - padding}
            y1={height - (percent / 100) * (height - padding * 2) - padding}
            y2={height - (percent / 100) * (height - padding * 2) - padding}
            stroke="var(--brown)"
            strokeWidth="0.5"
            opacity="0.3"
          />
        ))}

        {/* Static line - animations disabled for better performance */}
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="2"
        />

        {/* Static fill gradient */}
        <defs>
          <linearGradient id={`gradient-${label}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${pathD} L ${width - padding},${height - padding} L ${padding},${height - padding} Z`}
          fill={`url(#gradient-${label})`}
        />

        {/* Static dots - removed animation for performance */}
        {dataPoints.map((point, index) => {
          const x = (index / (dataPoints.length - 1)) * (width - padding * 2) + padding
          const y = height - (point.value / 100) * (height - padding * 2) - padding

          return (
            <circle
              key={point.timestamp}
              cx={x}
              cy={y}
              r="2"
              fill={color}
            />
          )
        })}
      </svg>
      <p style={{ fontSize: 'var(--font-size-small)', color: 'var(--white-20)', marginTop: '0.5rem' }}>
        {label}: <span style={{ color }}>{dataPoints[dataPoints.length - 1]?.value.toFixed(1)}</span>
      </p>
    </div>
  )
}
