interface BarData {
  label: string
  value: number
  color?: string
}

interface AnimatedBarChartProps {
  data: BarData[]
  maxValue?: number
}

export function AnimatedBarChart({ data, maxValue }: AnimatedBarChartProps) {
  const max = maxValue || Math.max(...data.map(d => d.value))

  return (
    <column
      gap-="1"
      style={{
        width: '100%',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'pan-y',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {data.map((item, index) => (
        <div key={item.label}>
          <row gap-="1" align-="center start">
            <span style={{ minWidth: '80px', fontSize: 'var(--font-size-small)', color: 'var(--white-20)' }}>
              {item.label}
            </span>
            <div style={{ flex: 1, height: '20px', background: 'var(--brown)', borderRadius: '2px', overflow: 'hidden', position: 'relative' }}>
              <div
                style={{
                  height: '100%',
                  width: `${(item.value / max) * 100}%`,
                  background: item.color || 'var(--lime)',
                  position: 'relative',
                  transition: 'width 0.3s ease-out'
                }}
              />
            </div>
            <span style={{ minWidth: '50px', textAlign: 'right', fontSize: 'var(--font-size)', fontWeight: 600, color: item.color || 'var(--lime)' }}>
              {item.value}
            </span>
          </row>
        </div>
      ))}
    </column>
  )
}
