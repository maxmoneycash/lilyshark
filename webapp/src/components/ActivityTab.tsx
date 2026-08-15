import { useEffect, useState, useRef } from 'react'
import { backendApi } from '../api/backend'

interface ActivityTabProps {
  currentTime: Date
}

export function ActivityTab({ currentTime }: ActivityTabProps) {
  // Load initial latency data from localStorage
  const [latencyData, setLatencyData] = useState<number[]>(() => {
    try {
      const stored = localStorage.getItem('shelby-latency-history')
      return stored ? JSON.parse(stored) : []
    } catch {
      return []
    }
  })
  const [currentLatency, setCurrentLatency] = useState<number>(0)
  const [eventCount, setEventCount] = useState<number>(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animationRef = useRef<number>()
  const lastFrameTime = useRef<number>(0)
  const lastDataLength = useRef<number>(0)

  // Interactive state
  const [isInteracting, setIsInteracting] = useState(false)
  const [pointerX, setPointerX] = useState<number | null>(null)
  const [targetPointerX, setTargetPointerX] = useState<number | null>(null)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  // Measure API latency every 15 seconds (optimized for scale - 100+ users)
  useEffect(() => {
    const measureLatency = async () => {
      const start = performance.now()
      try {
        await backendApi.health()
        const latency = performance.now() - start
        setCurrentLatency(latency)
        setLatencyData(prev => {
          // Mobile-first: Fewer points for better performance
          const isMobile = window.innerWidth < 768
          const maxPoints = isMobile ? 60 : 120  // Reduced from 120/180
          const newData = [...prev, latency].slice(-maxPoints)
          // Persist to localStorage
          localStorage.setItem('shelby-latency-history', JSON.stringify(newData))
          return newData
        })
      } catch {
        // Latency check failed - will retry on next interval
      }
    }
    measureLatency()
    const interval = setInterval(measureLatency, 15000) // 15s for scale (was 5s)
    return () => clearInterval(interval)
  }, [])

  // Fetch event count every 15s (optimized for scale - 100+ users)
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const events = await backendApi.getRecentEvents(50)
        setEventCount(events.length)
      } catch {
        // Failed to fetch events - will retry on next interval
      }
    }
    fetchEvents()
    const interval = setInterval(fetchEvents, 15000) // 15s for scale (was 5s)
    return () => clearInterval(interval)
  }, [])

  // Direct pointer positioning - no smoothing for instant response
  useEffect(() => {
    if (targetPointerX !== null) {
      setPointerX(targetPointerX)
    }
  }, [targetPointerX])

  // Chart rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Mobile-first: Lower frame rates for better battery life
    const isMobile = window.innerWidth < 768
    const targetFps = isMobile ? 20 : 30 // 20fps mobile, 30fps desktop
    const frameInterval = 1000 / targetFps

    const animate = (timestamp: number = performance.now()) => {
      // Throttle frame rate
      const elapsed = timestamp - lastFrameTime.current
      if (elapsed < frameInterval && !isInteracting) {
        animationRef.current = requestAnimationFrame(animate)
        return
      }
      lastFrameTime.current = timestamp

      // Track data changes for potential optimizations
      const dataChanged = latencyData.length !== lastDataLength.current
      lastDataLength.current = latencyData.length

      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()

      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`

      const width = canvas.width
      const height = canvas.height

      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, rect.width, rect.height)

      // Actual rendering dimensions
      const renderWidth = rect.width
      const renderHeight = rect.height

      // Chart line with smooth curves
      if (latencyData.length > 1) {
        // Use dynamic min/max based on actual data for full Y-axis usage
        const sorted = [...latencyData].sort((a, b) => a - b)
        const p5Index = Math.floor(sorted.length * 0.05)
        const p95Index = Math.floor(sorted.length * 0.95)
        const minValue = sorted[p5Index] || 0
        const maxValue = sorted[p95Index] || 50
        // Add 10% headroom on both ends
        const minLatency = Math.max(0, minValue * 0.9)
        const maxLatency = maxValue * 1.1
        const latencyRange = maxLatency - minLatency
        // Reserve space for Y-axis labels on the right (60px)
        const chartWidth = renderWidth - 60
        const pointSpacing = chartWidth / latencyData.length
        const chartHeight = renderHeight - 80

        // Glowing pink aesthetic
        const pinkGlow = '#FF69B4'  // Hot pink
        const pinkBright = '#FF1493'  // Deep pink

        // Build path for the line
        const buildPath = () => {
          ctx.beginPath()
          latencyData.forEach((latency, i) => {
            const x = i * pointSpacing
            // Clamp latency to range
            const clampedLatency = Math.max(minLatency, Math.min(latency, maxLatency))
            const y = 40 + chartHeight - (((clampedLatency - minLatency) / latencyRange) * chartHeight)

            if (i === 0) {
              ctx.moveTo(x, y)
            } else {
              const prevLatency = latencyData[i - 1]
              const clampedPrevLatency = Math.max(minLatency, Math.min(prevLatency, maxLatency))
              const prevX = (i - 1) * pointSpacing
              const prevY = 40 + chartHeight - (((clampedPrevLatency - minLatency) / latencyRange) * chartHeight)
              const cpX = prevX + (x - prevX) / 2
              const cpY = prevY + (y - prevY) / 2
              ctx.quadraticCurveTo(prevX, prevY, cpX, cpY)
            }
          })

          if (latencyData.length > 0) {
            const lastLatency = latencyData[latencyData.length - 1]
            const clampedLastLatency = Math.max(minLatency, Math.min(lastLatency, maxLatency))
            const lastX = (latencyData.length - 1) * pointSpacing
            const lastY = 40 + chartHeight - (((clampedLastLatency - minLatency) / latencyRange) * chartHeight)
            ctx.lineTo(lastX, lastY)
          }
        }

        // Subtle outer glow
        buildPath()
        ctx.strokeStyle = pinkGlow
        ctx.lineWidth = 2.5
        ctx.globalAlpha = 0.2
        ctx.shadowBlur = 15
        ctx.shadowColor = pinkBright
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.stroke()

        // Core thin line with minimal glow
        buildPath()
        ctx.strokeStyle = pinkBright
        ctx.lineWidth = 1
        ctx.globalAlpha = 1
        ctx.shadowBlur = 8
        ctx.shadowColor = '#FF69B4'
        ctx.stroke()

        // Reset
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1

        // Mobile: Draw "SHELBY PULSE" overlay in top left
        const isMobile = window.innerWidth < 768
        if (isMobile) {
          ctx.font = 'bold 24px Cascadia Code, monospace'
          ctx.fillStyle = '#FF1493'
          ctx.globalAlpha = 0.15
          ctx.textAlign = 'left'
          ctx.fillText('SHELBY', 15, 40)
          ctx.fillText('PULSE', 15, 68)
          ctx.globalAlpha = 1
        }

        // Always draw Y-axis labels
        ctx.font = '12px Cascadia Code, monospace'
        ctx.fillStyle = '#666666'
        ctx.textAlign = 'right'

        // Draw Y-axis labels for screenshotability
        const yLabels = [0, 25, 50, 75, 100]
        for (let i = 0; i < yLabels.length; i++) {
          const percent = yLabels[i]
          const value = minLatency + (latencyRange * percent) / 100
          const y = 40 + chartHeight - ((percent / 100) * chartHeight)
          ctx.fillText(`${Math.round(value)}ms`, renderWidth - 5, y + 4)
        }

        // Mark the latest data point with pulsing circle and label
        if (latencyData.length > 0) {
          const lastLatency = latencyData[latencyData.length - 1]
          const clampedLastLatency = Math.max(minLatency, Math.min(lastLatency, maxLatency))
          const lastX = (latencyData.length - 1) * pointSpacing
          const lastY = 40 + chartHeight - (((clampedLastLatency - minLatency) / latencyRange) * chartHeight)

          // Pulsing animation - same as crosshair
          const pulseTime = Date.now() / 800
          const pulseScale = 0.8 + Math.sin(pulseTime * Math.PI * 2) * 0.2

          // Outer pulsing glow
          ctx.beginPath()
          ctx.arc(lastX, lastY, 8 * pulseScale, 0, Math.PI * 2)
          ctx.fillStyle = '#FF69B4'
          ctx.globalAlpha = 0.3 * (1 - (pulseScale - 0.8) / 0.4)
          ctx.fill()

          // Inner circle
          ctx.beginPath()
          ctx.arc(lastX, lastY, 4, 0, Math.PI * 2)
          ctx.fillStyle = '#FF1493'
          ctx.globalAlpha = 1
          ctx.fill()

          // Draw label for latest value
          ctx.font = 'bold 14px Cascadia Code, monospace'
          ctx.fillStyle = '#FF1493'
          ctx.textAlign = 'center'
          ctx.fillText(`${Math.round(lastLatency)}ms`, lastX, lastY - 12)
        }

        // Draw interactive crosshair (only when actively interacting)
        if (isInteracting && pointerX !== null && latencyData.length > 1) {
          const index = Math.min(
            Math.max(0, Math.floor(pointerX / pointSpacing)),
            latencyData.length - 1
          )
          const latency = latencyData[index]
          const clampedLatency = Math.max(minLatency, Math.min(latency, maxLatency))
          const x = index * pointSpacing
          const y = 40 + chartHeight - (((clampedLatency - minLatency) / latencyRange) * chartHeight)

          // Crosshair vertical line - light grey
          ctx.beginPath()
          ctx.moveTo(x, 40)
          ctx.lineTo(x, renderHeight - 40)
          ctx.strokeStyle = '#999999'
          ctx.lineWidth = 2
          ctx.globalAlpha = 0.7
          ctx.shadowBlur = 0
          ctx.stroke()

          // Pulsing effect - calculate based on time
          const pulseTime = Date.now() / 800 // Pulse every 800ms
          const pulseScale = 0.8 + Math.sin(pulseTime * Math.PI * 2) * 0.2

          // Outer pulsing circle - light grey
          ctx.beginPath()
          ctx.arc(x, y, 10 * pulseScale, 0, Math.PI * 2)
          ctx.fillStyle = '#AAAAAA'
          ctx.globalAlpha = 0.3 * (1 - (pulseScale - 0.8) / 0.4)
          ctx.shadowBlur = 0
          ctx.fill()

          // Inner circle - medium grey
          ctx.beginPath()
          ctx.arc(x, y, 5, 0, Math.PI * 2)
          ctx.fillStyle = '#666666'
          ctx.globalAlpha = 1
          ctx.shadowBlur = 0
          ctx.fill()

          // Value label - adjust position to prevent text cutoff
          ctx.font = 'bold 20px Cascadia Code, monospace'
          ctx.fillStyle = '#1a1a1a'
          ctx.globalAlpha = 1
          ctx.shadowBlur = 0

          const labelText = `${Math.round(latency)}ms`
          const labelWidth = ctx.measureText(labelText).width
          const padding = 10

          // Adjust alignment based on position to prevent cutoff
          if (x + labelWidth / 2 + padding > renderWidth) {
            // Near right edge - align right
            ctx.textAlign = 'right'
            ctx.fillText(labelText, x - padding, y - 20)
          } else if (x - labelWidth / 2 - padding < 0) {
            // Near left edge - align left
            ctx.textAlign = 'left'
            ctx.fillText(labelText, x + padding, y - 20)
          } else {
            // Centered - default
            ctx.textAlign = 'center'
            ctx.fillText(labelText, x, y - 20)
          }

          ctx.shadowBlur = 0
          ctx.globalAlpha = 1

          // Update selected index
          if (index !== selectedIndex) {
            setSelectedIndex(index)
            // Haptic feedback on mobile
            if ('vibrate' in navigator) {
              navigator.vibrate(1)
            }
          }
        }
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
    }
  }, [latencyData, isInteracting, pointerX, selectedIndex])

  const avgLatency = latencyData.length > 0
    ? latencyData.reduce((a, b) => a + b, 0) / latencyData.length
    : 0

  const maxLatency = latencyData.length > 0 ? Math.max(...latencyData) : 0
  const minLatency = latencyData.length > 0 ? Math.min(...latencyData) : 0

  // Event handlers for interactivity
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault() // Prevent text selection and long-press menu
    setIsInteracting(true)
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    setTargetPointerX(x)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault() // Prevent text selection while dragging
    if (!isInteracting) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    setTargetPointerX(x)
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault() // Prevent any default behavior
    setIsInteracting(false)
    setPointerX(null)
    setTargetPointerX(null)
    setSelectedIndex(null)
  }

  const handlePointerLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault() // Prevent any default behavior
    setIsInteracting(false)
    setPointerX(null)
    setTargetPointerX(null)
    setSelectedIndex(null)
  }

  return (
    <column gap-="1" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          flex: '1 1 auto',
          minHeight: window.innerWidth >= 1024 ? '300px' : '400px',
          maxHeight: window.innerWidth >= 1024 ? '40vh' : 'none',
          marginBottom: '1rem',
          cursor: isInteracting ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          WebkitTapHighlightColor: 'transparent'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerUp}
        onContextMenu={(e) => e.preventDefault()}
      />

      <row box-="double round" shear-="top" pad-="1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: window.innerWidth >= 1024 ? '1rem' : '2rem', flexShrink: 0, transition: 'gap 0.3s ease' }}>
        <column style={{ gap: '0.5rem', gridColumn: '1 / -1', marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
          <row gap-="1">
            <span is-="badge" variant-="pink" cap-="ribbon slant-bottom">Latency Metrics</span>
          </row>
        </column>
        <column style={{ gap: '0.5rem' }}>
          <row gap-="0.5" align-="center">
            <span is-="badge" variant-="pink-pastel" cap-="round" size-="half">
              {isInteracting && selectedIndex !== null ? 'Selected' : 'Current'}
            </span>
          </row>
          <h2 style={{
            color: '#FF1493',
            fontSize: window.innerWidth >= 1024 ? '1.75rem' : '2.25rem',
            fontWeight: 700,
            margin: 0,
            fontVariantNumeric: 'tabular-nums',
            transition: 'transform 0.2s ease',
            transform: isInteracting ? 'scale(1.05)' : 'scale(1)'
          }}>
            {isInteracting && selectedIndex !== null
              ? latencyData[selectedIndex].toFixed(0)
              : currentLatency.toFixed(0)}ms
          </h2>
        </column>
        <column style={{ gap: '0.5rem' }}>
          <span is-="badge" variant-="background2" cap-="round" size-="half">Average</span>
          <h2 style={{ fontSize: window.innerWidth >= 1024 ? '1.75rem' : '2.25rem', fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{avgLatency.toFixed(0)}ms</h2>
        </column>
        <column style={{ gap: '0.5rem' }}>
          <span is-="badge" variant-="green" cap-="round" size-="half">Min</span>
          <h2 style={{ color: '#00C896', fontSize: window.innerWidth >= 1024 ? '1.75rem' : '2.25rem', fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{minLatency.toFixed(0)}ms</h2>
        </column>
        <column style={{ gap: '0.5rem' }}>
          <span is-="badge" variant-="red" cap-="round" size-="half">Max</span>
          <h2 style={{ color: '#FF6B6B', fontSize: window.innerWidth >= 1024 ? '1.75rem' : '2.25rem', fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{maxLatency.toFixed(0)}ms</h2>
        </column>
        <column style={{ gap: '0.5rem' }}>
          <span is-="badge" variant-="blue" cap-="round" size-="half">Events</span>
          <h2 style={{ color: '#4A90E2', fontSize: window.innerWidth >= 1024 ? '1.75rem' : '2.25rem', fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{eventCount}</h2>
        </column>
        <column style={{ gap: '0.5rem' }}>
          <span is-="badge" variant-="background2" cap-="round" size-="half">History</span>
          <h2 style={{ fontSize: window.innerWidth >= 1024 ? '1.75rem' : '2.25rem', fontWeight: 700, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
            {latencyData.length < 60
              ? `${latencyData.length}s`
              : `${(latencyData.length / 60).toFixed(1)}min`}
          </h2>
        </column>
      </row>
    </column>
  )
}
