interface NetworkStats {
  totalBlobs: number
  totalStorage: number
  totalStorageFormatted: string
  uploadRate: number
  timestamp: number
}

interface OverviewTabProps {
  networkStats: NetworkStats
}

export function OverviewTab({ networkStats }: OverviewTabProps) {
  return (
    <column gap-="1">
      <row gap-="1" align-="between">
        <h1><span is-="badge" variant-="pink">Shelby Network</span></h1>
        <span is-="badge" variant-="success">◉ LIVE</span>
      </row>

      <small style={{ color: 'var(--foreground2)' }}>
        Real-time data from Shelby Protocol on Aptos
      </small>

      <div is-="separator"></div>

      {/* Network-wide Shelby Metrics */}
      <row gap-="1" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', transition: 'gap 0.3s ease' }}>
        <column box-="square" pad-="1" gap-="0.5">
          <row gap-="1" align-="between">
            <small style={{ color: 'var(--foreground1)' }}>Total Blobs</small>
            <span is-="badge" variant-="success" size-="half">{networkStats.totalBlobs.toLocaleString()}</span>
          </row>
          <small style={{ color: 'var(--foreground2)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Total blobs stored on Shelby Protocol
          </small>
        </column>

        <column box-="square" pad-="1" gap-="0.5">
          <row gap-="1" align-="between">
            <small style={{ color: 'var(--foreground1)' }}>Total Storage</small>
            <span is-="badge" variant-="blue" size-="half">{networkStats.totalStorageFormatted}</span>
          </row>
          <small style={{ color: 'var(--foreground2)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Combined size of all blobs on Shelby
          </small>
        </column>

        <column box-="square" pad-="1" gap-="0.5">
          <row gap-="1" align-="between">
            <small style={{ color: 'var(--foreground1)' }}>Upload Rate</small>
            <span is-="badge" variant-="pink-pastel" size-="half">{networkStats.uploadRate.toFixed(2)}/min</span>
          </row>
          <small style={{ color: 'var(--foreground2)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
            Average blob uploads per minute
          </small>
        </column>
      </row>

      <div is-="separator"></div>

      {/* Network Info */}
      <column box-="square" pad-="1">
        <h3 style={{ marginBottom: '0.5rem' }}>Protocol Information</h3>
        <small style={{ color: 'var(--foreground2)' }}>
          Shelby Protocol is a decentralized storage system built on Aptos blockchain
        </small>
        <small style={{ color: 'var(--foreground2)', marginTop: '0.5rem', display: 'block' }}>
          View full explorer: <a href="https://explorer.aptoslabs.com/?network=shelbynet" target="_blank" rel="noopener noreferrer">
            Shelby Explorer
          </a>
        </small>
      </column>
    </column>
  )
}
