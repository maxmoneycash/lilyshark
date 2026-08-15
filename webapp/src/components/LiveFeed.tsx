import type { Blob } from '../api/shelby'
import { useState, useEffect } from 'react'

interface Props {
  blobs: Blob[]
}

export default function LiveFeed({ blobs }: Props) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(prev => prev + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  return (
    <column
      box-="double"
      shear-="bottom"
      pad-="2 1"
      gap-="1"
      style={{
        background: 'var(--background1)'
      }}
    >
      <row align-="center between">
        <h3 style={{ color: 'var(--yellow)', margin: 0 }}>
          ╔════════════════╗<br/>
          ║ LIVE UPLOADS  ║<br/>
          ╚════════════════╝
        </h3>
        <span is-="badge" variant-="green">
          ◉ {blobs.length} recent
        </span>
      </row>

      <column gap-="1.5">
        {blobs.map((blob, index) => (
          <column
            key={blob.id}
            box-="square"
            pad-="1 1.5"
            gap-="0"
            style={{
              background: 'var(--background0)',
              borderLeft: `0.3ch solid var(--${index === 0 ? 'green' : index === 1 ? 'blue' : 'yellow'})`,
              transition: 'all 0.3s ease'
            }}
          >
            <span style={{
              fontSize: '0.8em',
              color: 'var(--foreground2)',
              marginBottom: '0.5lh'
            }}>
              ⏱ {index * 3 + 3}s ago
            </span>
            <span style={{
              fontWeight: 600,
              color: 'var(--foreground0)',
              marginBottom: '0.5lh'
            }}>
              ▸ {blob.owner} • {blob.name}
            </span>
            <row gap-="2" style={{ fontSize: '0.9em' }}>
              <span is-="badge" variant-="blue">
                [{blob.size}]
              </span>
              <span is-="badge" variant-="foreground0">
                {blob.encoding}
              </span>
            </row>
          </column>
        ))}
      </column>

      <button
        is-="button"
        variant-="primary"
        size-="medium"
        style={{
          marginTop: '1lh'
        }}
      >
        [ View All Activity →]
      </button>
    </column>
  )
}
