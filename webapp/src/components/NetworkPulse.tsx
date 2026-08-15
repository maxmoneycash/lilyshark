import type { NetworkStats } from '../api/shelby'

interface Props {
  stats: NetworkStats | undefined
  isLoading: boolean
}

export default function NetworkPulse({ stats, isLoading }: Props) {
  if (isLoading || !stats) {
    return (
      <column
        box-="round"
        shear-="top"
        pad-="2 1"
        style={{
          background: 'var(--background1)',
          minHeight: '30lh'
        }}
      >
        <h3 style={{ color: 'var(--green)', marginBottom: '1lh' }}>
          NETWORK PULSE
        </h3>
        <span style={{ color: 'var(--foreground1)' }}>Loading...</span>
      </column>
    )
  }

  return (
    <column
      box-="round"
      shear-="top"
      pad-="2 1"
      gap-="2"
      style={{ background: 'var(--background1)' }}
    >
      <h3 style={{ color: 'var(--green)', margin: 0 }}>
        ╭──────────────────╮<br/>
        │ NETWORK PULSE   │<br/>
        ╰──────────────────╯
      </h3>

      {/* Total Blobs */}
      <column gap-="0">
        <span style={{
          fontSize: '2.5em',
          fontWeight: 'bold',
          color: 'var(--foreground0)',
          lineHeight: 1
        }}>
          [{stats.totalBlobs.toLocaleString()}]
        </span>
        <span style={{
          fontSize: '0.9em',
          color: 'var(--foreground2)',
          marginTop: '0.5lh'
        }}>
          ▸ TOTAL BLOBS
        </span>
        <span style={{
          marginTop: '0.5lh',
          color: 'var(--green)'
        }}>
          ▲ +1,247 today
        </span>
      </column>

      {/* Storage */}
      <column gap-="0">
        <span style={{
          fontSize: '2em',
          fontWeight: 'bold',
          color: 'var(--foreground0)',
          lineHeight: 1
        }}>
          [{stats.totalStorage}]
        </span>
        <span style={{
          fontSize: '0.9em',
          color: 'var(--foreground2)',
          marginTop: '0.5lh'
        }}>
          ▸ TOTAL STORAGE
        </span>
        <span style={{
          marginTop: '0.5lh',
          color: 'var(--blue)'
        }}>
          ▲ +89 MB/hour
        </span>
      </column>

      {/* Upload Rate */}
      <column gap-="0">
        <span style={{
          fontSize: '1.5em',
          fontWeight: 'bold',
          color: 'var(--foreground0)',
          lineHeight: 1
        }}>
          [{stats.uploadRate.toFixed(1)}] blobs/min
        </span>
        <span style={{
          fontSize: '0.9em',
          color: 'var(--foreground2)',
          marginTop: '0.5lh'
        }}>
          ▸ UPLOAD RATE
        </span>
        <div style={{
          marginTop: '1lh',
          background: 'var(--background3)',
          height: '1lh',
          position: 'relative',
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            width: `${Math.min((stats.uploadRate / 10) * 100, 100)}%`,
            background: 'var(--green)',
            transition: 'width 0.5s ease'
          }} />
        </div>
        <span style={{ fontSize: '0.75em', color: 'var(--foreground2)', marginTop: '0.5lh' }}>
          {'▓'.repeat(Math.floor((stats.uploadRate / 10) * 20))}{'░'.repeat(20 - Math.floor((stats.uploadRate / 10) * 20))}
        </span>
      </column>

      {/* Active Accounts */}
      <row gap-="1" style={{
        paddingTop: '1lh',
        borderTop: '0.1ch solid var(--box-border-color)'
      }}>
        <span is-="badge" variant-="blue">
          ◉ Active: 23
        </span>
        <span is-="badge" variant-="yellow">
          ▲ Peak: 89
        </span>
      </row>
    </column>
  )
}
