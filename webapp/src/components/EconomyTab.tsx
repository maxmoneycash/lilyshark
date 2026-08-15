import { useEffect, useState, memo } from 'react';
import { backendApi } from '../api/backend';
import { AsciiBar } from './AsciiBar';

// Terminal-style blinking cursor
const BlinkingCursor = memo(() => (
  <span className="terminal-cursor">█</span>
));
BlinkingCursor.displayName = 'BlinkingCursor';

// ASCII progress bar that animates
const AsciiLoadingBar = memo(({ width = 20 }: { width?: number }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setFrame(f => (f + 1) % width), 80);
    return () => clearInterval(interval);
  }, [width]);

  const bar = Array.from({ length: width }).map((_, i) => {
    if (i === frame) return '█';
    if (i === (frame + 1) % width) return '▓';
    if (i === (frame + 2) % width) return '▒';
    return '░';
  }).join('');

  return <span style={{ color: 'var(--green)', fontFamily: 'monospace' }}>[{bar}]</span>;
});
AsciiLoadingBar.displayName = 'AsciiLoadingBar';

// Terminal loading message with typewriter effect
const TerminalLine = memo(({ text, delay = 0, color = 'var(--green)' }: { text: string; delay?: number; color?: string }) => {
  const [visible, setVisible] = useState(delay === 0);
  useEffect(() => {
    if (delay > 0) {
      const timer = setTimeout(() => setVisible(true), delay);
      return () => clearTimeout(timer);
    }
  }, [delay]);

  if (!visible) return null;
  return (
    <row style={{ fontFamily: 'monospace', fontSize: '0.85rem', gap: '0.5rem' }}>
      <span style={{ color: 'var(--accent)' }}>$</span>
      <span style={{ color }}>{text}</span>
      <BlinkingCursor />
    </row>
  );
});
TerminalLine.displayName = 'TerminalLine';

// Terminal-style loading skeleton for leaderboard
const TerminalLeaderboardSkeleton = memo(({ title, count = 8, isDesktop = false }: { title: string; count?: number; isDesktop?: boolean }) => (
  <column gap-="0" style={{ fontFamily: 'monospace', fontSize: isDesktop ? '0.7rem' : '0.8rem' }}>
    <row style={{ color: 'var(--foreground2)', padding: '0.25rem 0.5rem', borderBottom: '1px dashed var(--background2)' }}>
      <span style={{ opacity: 0.6 }}>{'>'} fetching {title.toLowerCase()}...</span>
    </row>
    {Array.from({ length: count }).map((_, i) => (
      <row
        key={`skel-${i}`}
        style={{
          padding: isDesktop ? '0.25rem 0.5rem' : '0.4rem 0.5rem',
          gap: '0.75rem',
          alignItems: 'center',
          opacity: 0.4,
          animation: 'terminalFade 1s ease-in-out infinite',
          animationDelay: `${i * 0.08}s`,
        }}
      >
        <span style={{ color: 'var(--yellow)', minWidth: '1.5rem' }}>{String(i + 1).padStart(2, '0')}.</span>
        <span style={{ color: 'var(--foreground2)' }}>{'░'.repeat(6)}...{'░'.repeat(4)}</span>
        <span style={{ flex: 1, color: 'var(--background2)' }}>{'─'.repeat(isDesktop ? 8 : 12)}</span>
        <span style={{ color: 'var(--foreground2)' }}>{'░'.repeat(4)}</span>
      </row>
    ))}
  </column>
));
TerminalLeaderboardSkeleton.displayName = 'TerminalLeaderboardSkeleton';

// Full terminal-style loading state
const LoadingState = memo(({ isDesktop = false }: { isDesktop?: boolean }) => (
  <column gap-={isDesktop ? "0.5" : "1"} pad-={isDesktop ? "0.5" : "1"} style={{ overflowY: 'auto', height: '100%' }}>
    {/* Terminal Header */}
    <column box-="double" shear-="top" pad-="1" gap-="0.75">
      <row gap-="1" align-="between">
        <span is-="badge" variant-="pink" cap-="ribbon triangle">SHELBYUSD ECONOMY</span>
        <row gap-="0.5">
          <span is-="badge" variant-="background2" cap-="round" size-="half">ShelbyNet (Devnet)</span>
          <span is-="badge" variant-="yellow" cap-="round" size-="half">
            <span is-="spinner" style={{ fontSize: '0.6rem' }}></span> SYNC
          </span>
        </row>
      </row>

      {/* Terminal boot messages */}
      <column gap-="0.25" style={{ marginTop: '0.5rem' }}>
        <TerminalLine text="connecting to aptos indexer..." delay={0} />
        <TerminalLine text="querying shelbyusd_coin events..." delay={400} color="var(--foreground)" />
        <TerminalLine text="aggregating holder balances..." delay={800} color="var(--foreground)" />
      </column>
    </column>

    {/* Stats with ASCII loading */}
    <column box-="round" shear-="top" pad-="1">
      <row style={{ marginBottom: '0.75rem', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>■</span>
        <span style={{ color: 'var(--foreground)', fontFamily: 'monospace', fontSize: '0.8rem' }}>NETWORK STATS</span>
        <AsciiLoadingBar width={isDesktop ? 15 : 10} />
      </row>
      <row style={{
        display: 'grid',
        gridTemplateColumns: isDesktop ? 'repeat(6, 1fr)' : 'repeat(auto-fit, minmax(100px, 1fr))',
        gap: isDesktop ? '0.5rem' : '0.75rem',
        width: '100%',
        boxSizing: 'border-box'
      }}>
        {[
          { label: 'Supply', color: '#4A90E2' },
          { label: 'Holders', color: '#00C896' },
          { label: 'All-Time Vol', color: '#FFA500' },
          { label: 'Total Txs', color: '#FF1493' },
          { label: '24h Vol', color: '#4A90E2' },
          { label: '24h Txs', color: '#00C896' },
        ].map(({ label, color }, i) => (
          <column key={label} gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>{label}</small>
            <span style={{
              color,
              fontSize: isDesktop ? '1.1rem' : '1.5rem',
              fontWeight: 700,
              animation: 'terminalBlink 0.8s step-end infinite',
              animationDelay: `${i * 0.1}s`,
            }}>_</span>
          </column>
        ))}
      </row>
    </column>

    {/* Leaderboards with terminal aesthetic */}
    <row style={{ display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: isDesktop ? '0.5rem' : '1rem', flexDirection: 'column' }}>
      <column box-="double" shear-="top" pad-={isDesktop ? "0.5" : "0.75"}>
        <row gap-="0.5" style={{ marginBottom: '0.25rem' }}>
          <span is-="badge" variant-="accent" cap-="triangle ribbon" size-={isDesktop ? "half" : undefined}>Top Holders</span>
        </row>
        <TerminalLeaderboardSkeleton title="holders" count={isDesktop ? 8 : 10} isDesktop={isDesktop} />
      </column>

      <column box-="round" shear-="top" pad-={isDesktop ? "0.5" : "0.75"}>
        <row gap-="0.5" style={{ marginBottom: '0.25rem' }}>
          <span is-="badge" variant-="blue" cap-="slant-bottom triangle" size-={isDesktop ? "half" : undefined}>Most Active</span>
        </row>
        <TerminalLeaderboardSkeleton title="activity" count={isDesktop ? 8 : 10} isDesktop={isDesktop} />
      </column>
    </row>
    <column box-="double round" shear-="top" pad-="0.75" gap-="0.5">
      <row gap-="1" align-="between">
        <span is-="badge" variant-="pink" cap-="ribbon triangle">FAUCET FARMING</span>
        <span style={{ color: 'var(--foreground2)', fontFamily: 'monospace', fontSize: '0.7rem' }}>
          [STANDBY]
        </span>
      </row>
      <row style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: 'var(--foreground2)', gap: '0.5rem' }}>
        <span style={{ color: 'var(--yellow)', fontFamily: 'monospace' }}>!</span>
        <span>waiting for wallet connection...</span>
      </row>
    </column>

    {/* Bottom leaderboards */}
    <row style={{ display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: isDesktop ? '0.5rem' : '1rem', flexDirection: 'column' }}>
      <column box-="double round" shear-="top" pad-={isDesktop ? "0.5" : "0.75"}>
        <row gap-="0.5" style={{ marginBottom: '0.25rem' }}>
          <span is-="badge" variant-="yellow" cap-="ribbon slant-top" size-={isDesktop ? "half" : undefined}>💸 Biggest Spenders</span>
        </row>
        <TerminalLeaderboardSkeleton title="spenders" count={isDesktop ? 8 : 10} isDesktop={isDesktop} />
      </column>

      <column box-="round" shear-="both" pad-={isDesktop ? "0.5" : "0.75"}>
        <row gap-="0.5" style={{ marginBottom: '0.25rem' }}>
          <span is-="badge" variant-="green" cap-="triangle triangle" size-={isDesktop ? "half" : undefined}>Recent Activity</span>
        </row>
        <TerminalLeaderboardSkeleton title="transactions" count={isDesktop ? 8 : 10} isDesktop={isDesktop} />
      </column>
    </row>

    {/* Terminal-style animations */}
    <style>{`
      .terminal-cursor {
        animation: terminalBlink 1s step-end infinite;
        color: var(--green);
      }
      @keyframes terminalBlink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
      }
      @keyframes terminalFade {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.6; }
      }
    `}</style>
  </column>
));
LoadingState.displayName = 'LoadingState';

interface LeaderboardEntry {
  address: string;
  balance: number;
  barWidth: number;
}

interface VolumeData {
  volume24h: number;
  transferCount24h: number;
  velocity: number;
}

interface AllTimeStats {
  totalSupply: number;
  totalHolders: number;
  totalTransactions: number;
  totalVolume: number;
  averageTransactionSize: number;
  firstTransactionVersion: string;
  lastTransactionVersion: string;
}

interface ActivityEntry {
  address: string;
  txCount: number;
  barWidth: number;
}

interface SpenderEntry {
  address: string;
  totalSpent: number;
  barWidth: number;
}

interface RecentTransaction {
  address: string;
  type: 'deposit' | 'withdraw' | 'mint' | 'burn';
  amount: number;
  version: number;
}

interface NetworkActivityMetrics {
  activityBreakdown: {
    deposits: number;
    withdrawals: number;
    mints: number;
    burns: number;
    total: number;
  };
  activity24h: {
    uniqueWallets: number;
    transactionCount: number;
    totalVolume: number;
    avgTxSize: number;
  };
  storage24h: {
    blobCount: number;
    totalBytes: number;
    uniqueUploaders: number;
    avgBlobSize: number;
  };
  topUploaders: Array<{
    address: string;
    addressShort: string;
    blobCount: number;
    totalBytes: number;
    totalBytesFormatted: string;
    avgBlobSize: number;
    topFileType: string | null;
  }>;
}

interface EconomyData {
  leaderboard: LeaderboardEntry[];
  volume: VolumeData;
  allTimeStats: AllTimeStats;
  mostActive: ActivityEntry[];
  topSpenders: SpenderEntry[];
  recentTransactions: RecentTransaction[];
  networkActivity?: NetworkActivityMetrics;
  timestamp: number;
}

const EconomyTabComponent = () => {
  const [data, setData] = useState<EconomyData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchEconomy = async (forceRefresh = false) => {
      try {
        const economyData = await backendApi.getEconomy(forceRefresh);
        setData(economyData);
        setIsLoading(false);
      } catch {
        setIsLoading(false);
      }
    };

    fetchEconomy();
    const interval = setInterval(() => fetchEconomy(false), 60000); // Refresh every 60s

    return () => {
      clearInterval(interval);
    };
  }, []);

  const shortenAddress = (address: string) => {
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-5)}`;
  };

  // Format large transaction counts (no decimals conversion)
  const formatTxCount = (count: number) => {
    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(2)}M`;
    }
    if (count >= 1_000) {
      return `${(count / 1_000).toFixed(2)}K`;
    }
    return count.toLocaleString();
  };

  const formatAmount = (amount: number) => {
    // ShelbyUSD has 8 decimals, so convert from smallest units first
    const shelbyUSD = amount / 100_000_000;

    if (shelbyUSD >= 1_000_000) {
      return `${(shelbyUSD / 1_000_000).toFixed(2)}M`;
    }
    if (shelbyUSD >= 1_000) {
      return `${(shelbyUSD / 1_000).toFixed(2)}K`;
    }
    if (shelbyUSD >= 1) {
      return shelbyUSD.toFixed(2);
    }
    if (shelbyUSD >= 0.01) {
      return shelbyUSD.toFixed(4);
    }
    if (shelbyUSD >= 0.0001) {
      return shelbyUSD.toFixed(6);
    }
    // For very small amounts, show in scientific notation or raw units
    if (shelbyUSD > 0) {
      // Show raw units for clarity
      return `${amount.toLocaleString()} units`;
    }
    return '0';
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getTransactionLabel = (type: RecentTransaction['type']) => {
    switch (type) {
      case 'mint':
        return { icon: '✨', label: 'Minted', color: '#00C896' };
      case 'deposit':
        return { icon: '↓', label: 'Received', color: '#4A90E2' };
      case 'withdraw':
        return { icon: '↑', label: 'Sent', color: '#FFA500' };
      case 'burn':
        return { icon: '🔥', label: 'Burned', color: '#FF1493' };
      default:
        return { icon: '•', label: type, color: 'var(--foreground2)' };
    }
  };

  const isDesktop = window.innerWidth >= 1024;
  const maxEntries = isDesktop ? 8 : 10;

  // Show loading state with skeleton UI
  if (isLoading || !data) {
    return <LoadingState isDesktop={isDesktop} />;
  }

  return (
    <column gap-={isDesktop ? "0.5" : "2"} pad-={isDesktop ? "0.5" : "1"} style={{ overflowY: 'auto', height: '100%' }}>
      {/* Header */}
      <column box-="double round" shear-="top" pad-={isDesktop ? "0.5" : "1"} gap-="0.5">
        <row gap-="1" align-="between" style={{ marginTop: isDesktop ? '0' : '0' }}>
          <span is-="badge" variant-="pink" cap-="ribbon triangle">SHELBYUSD ECONOMY</span>
          <row gap-="0.5">
            <span is-="badge" variant-="background2" cap-="round" size-="half">ShelbyNet (Devnet)</span>
            <span is-="badge" variant-="success" cap-="round" size-="half">◉ LIVE</span>
          </row>
        </row>
        {!isDesktop && (
          <small style={{ color: 'var(--foreground2)' }}>
            All-time ShelbyUSD statistics since network inception • Value accrual preview for future $Shelby token
          </small>
        )}
      </column>

      {/* Compact Combined Stats */}
      <column box-="round" shear-="top" pad-={isDesktop ? "1" : "1"}>
        <row style={{
          display: 'grid',
          gridTemplateColumns: isDesktop ? 'repeat(6, 1fr)' : 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: isDesktop ? '0.5rem' : '0.75rem',
          fontSize: isDesktop ? '0.7rem' : '0.85rem',
          width: '100%',
          boxSizing: 'border-box'
        }}>
          <column gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>Supply</small>
            <span style={{ color: '#4A90E2', fontSize: isDesktop ? '1.1rem' : '1.5rem', fontWeight: 700 }}>{formatAmount(data.allTimeStats.totalSupply)}</span>
          </column>
          <column gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>Holders</small>
            <span style={{ color: '#00C896', fontSize: isDesktop ? '1.1rem' : '1.5rem', fontWeight: 700 }}>{data.allTimeStats.totalHolders}</span>
          </column>
          <column gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>All-Time Vol</small>
            <span style={{ color: '#FFA500', fontSize: isDesktop ? '1.1rem' : '1.5rem', fontWeight: 700 }}>{formatAmount(data.allTimeStats.totalVolume)}</span>
          </column>
          <column gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>Total Txs</small>
            <span style={{ color: '#FF1493', fontSize: isDesktop ? '1.1rem' : '1.5rem', fontWeight: 700 }}>
              {formatTxCount(data.allTimeStats.totalTransactions)}
            </span>
          </column>
          <column gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>24h Vol</small>
            <span style={{ color: '#4A90E2', fontSize: isDesktop ? '1.1rem' : '1.5rem', fontWeight: 700 }}>{formatAmount(data.volume.volume24h)}</span>
          </column>
          <column gap-="0" style={{ textAlign: 'center', minWidth: 0, overflow: 'hidden' }}>
            <small style={{ color: 'var(--foreground2)', fontSize: isDesktop ? '0.65rem' : '0.7rem', textTransform: 'uppercase' }}>24h Txs</small>
            <span style={{ color: '#00C896', fontSize: isDesktop ? '1.1rem' : '1.5rem', fontWeight: 700 }}>{formatTxCount(data.volume.transferCount24h)}</span>
          </column>
        </row>
      </column>

      {/* Network Activity Metrics */}
      {data.networkActivity && (
        <>
          {/* 24h Activity Stats - Developer-focused metrics */}
          <column box-="double" shear-="top" pad-={isDesktop ? "0.75" : "1"}>
            <row gap-="1" align-="between" style={{ marginBottom: '0.5rem' }}>
              <span is-="badge" variant-="accent" cap-="ribbon triangle">24H NETWORK ACTIVITY</span>
              <span is-="badge" variant-="background2" cap-="round" size-="half">Developer Metrics</span>
            </row>
            <row style={{
              display: 'grid',
              gridTemplateColumns: isDesktop ? 'repeat(6, 1fr)' : 'repeat(3, 1fr)',
              gap: isDesktop ? '0.5rem' : '0.75rem',
              width: '100%',
            }}>
              <column gap-="0" style={{ textAlign: 'center' }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Active Wallets</small>
                <span style={{ color: '#4A90E2', fontSize: isDesktop ? '1.1rem' : '1.3rem', fontWeight: 700 }}>
                  {data.networkActivity.activity24h.uniqueWallets}
                </span>
              </column>
              <column gap-="0" style={{ textAlign: 'center' }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Token Txs</small>
                <span style={{ color: '#00C896', fontSize: isDesktop ? '1.1rem' : '1.3rem', fontWeight: 700 }}>
                  {formatTxCount(data.networkActivity.activity24h.transactionCount)}
                </span>
              </column>
              <column gap-="0" style={{ textAlign: 'center' }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Avg Tx Size</small>
                <span style={{ color: '#FFA500', fontSize: isDesktop ? '1.1rem' : '1.3rem', fontWeight: 700 }}>
                  {formatAmount(data.networkActivity.activity24h.avgTxSize)}
                </span>
              </column>
              <column gap-="0" style={{ textAlign: 'center' }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Blobs Uploaded</small>
                <span style={{ color: '#FF1493', fontSize: isDesktop ? '1.1rem' : '1.3rem', fontWeight: 700 }}>
                  {data.networkActivity.storage24h.blobCount}
                </span>
              </column>
              <column gap-="0" style={{ textAlign: 'center' }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Storage Used</small>
                <span style={{ color: '#9B59B6', fontSize: isDesktop ? '1.1rem' : '1.3rem', fontWeight: 700 }}>
                  {formatBytes(data.networkActivity.storage24h.totalBytes)}
                </span>
              </column>
              <column gap-="0" style={{ textAlign: 'center' }}>
                <small style={{ color: 'var(--foreground2)', fontSize: '0.65rem', textTransform: 'uppercase' }}>Uploaders</small>
                <span style={{ color: '#E74C3C', fontSize: isDesktop ? '1.1rem' : '1.3rem', fontWeight: 700 }}>
                  {data.networkActivity.storage24h.uniqueUploaders}
                </span>
              </column>
            </row>
          </column>

          {/* Activity Breakdown and Top Uploaders */}
          <row style={{ display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: isDesktop ? '0.5rem' : '1rem', flexDirection: 'column' }}>
            {/* Activity Breakdown */}
            <column box-="round" shear-="top" pad-={isDesktop ? "0.5" : "0.75"} gap-="0.5">
              <row gap-="0.5" style={{ marginBottom: '0.25rem' }}>
                <span is-="badge" variant-="blue" cap-="slant-bottom triangle" size-={isDesktop ? "half" : undefined}>Transaction Types</span>
                <span is-="badge" variant-="background2" cap-="round" size-="half">All-Time</span>
              </row>
              <column gap-="0.25" style={{ fontSize: '0.8rem' }}>
                {[
                  { label: 'Mints', value: data.networkActivity.activityBreakdown.mints, color: '#00C896', icon: '✨' },
                  { label: 'Deposits', value: data.networkActivity.activityBreakdown.deposits, color: '#4A90E2', icon: '↓' },
                  { label: 'Withdrawals', value: data.networkActivity.activityBreakdown.withdrawals, color: '#FFA500', icon: '↑' },
                  { label: 'Burns', value: data.networkActivity.activityBreakdown.burns, color: '#FF1493', icon: '🔥' },
                ].map(({ label, value, color, icon }) => {
                  const total = data.networkActivity!.activityBreakdown.total;
                  const percentage = total > 0 ? (value / total * 100) : 0;
                  return (
                    <row key={label} style={{ padding: '0.25rem 0.5rem', gap: '0.5rem', alignItems: 'center' }}>
                      <span style={{ color, minWidth: '1.5rem' }}>{icon}</span>
                      <span style={{ color: 'var(--foreground)', minWidth: '5rem' }}>{label}</span>
                      <span style={{ flex: 1, height: '6px', background: 'var(--background2)', borderRadius: '3px', overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${percentage}%`, height: '100%', background: color, borderRadius: '3px' }} />
                      </span>
                      <span style={{ color, fontWeight: 600, minWidth: '3rem', textAlign: 'right' }}>
                        {formatTxCount(value)}
                      </span>
                      <span style={{ color: 'var(--foreground2)', fontSize: '0.7rem', minWidth: '3rem', textAlign: 'right' }}>
                        {percentage.toFixed(1)}%
                      </span>
                    </row>
                  );
                })}
              </column>
            </column>

            {/* Top Uploaders */}
            <column box-="double round" shear-="top" pad-={isDesktop ? "0.5" : "0.75"} gap-="0.5">
              <row gap-="0.5" style={{ marginBottom: '0.25rem' }}>
                <span is-="badge" variant-="pink" cap-="ribbon slant-top" size-={isDesktop ? "half" : undefined}>📦 Top Uploaders</span>
                <span is-="badge" variant-="background2" cap-="round" size-="half">by storage</span>
              </row>
              <column gap-="0" style={{ fontSize: isDesktop ? '0.7rem' : '0.8rem', fontFamily: 'monospace' }}>
                {data.networkActivity.topUploaders.slice(0, 5).map((uploader, i) => (
                  <column key={`uploader-${i}-${uploader.address}`} gap-="0">
                    <row style={{
                      padding: isDesktop ? '0.25rem 0.5rem' : '0.35rem 0.5rem',
                      gap: '0.5rem',
                      alignItems: 'center',
                    }}>
                      <span style={{ color: 'var(--foreground2)', minWidth: '1.2rem' }}>{i + 1}.</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {uploader.addressShort}
                      </span>
                      <span style={{ color: '#9B59B6', fontWeight: 600 }}>
                        {uploader.totalBytesFormatted}
                      </span>
                      <span style={{ color: 'var(--foreground2)', fontSize: '0.65rem' }}>
                        {uploader.blobCount} blobs
                      </span>
                      {uploader.topFileType && (
                        <span is-="badge" variant-="background2" cap-="round" size-="half" style={{ fontSize: '0.6rem' }}>
                          {uploader.topFileType}
                        </span>
                      )}
                    </row>
                    {i < 4 && (
                      <div style={{ height: '1px', background: 'var(--background2)', margin: '0 0.5rem' }} />
                    )}
                  </column>
                ))}
              </column>
            </column>
          </row>
        </>
      )}

      {/* 2-column layout on desktop */}
      <row style={{ display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: isDesktop ? '0.5rem' : '2rem', flexDirection: 'column' }}>
        {/* Top Holders Leaderboard */}
        <column box-="double" shear-="top" pad-={isDesktop ? "0.5" : "1"} gap-={isDesktop ? "0.5" : "1"}>
          <row gap-="1" align-="between" style={{ marginBottom: isDesktop ? '0.25rem' : '0.5rem' }}>
            <span is-="badge" variant-="accent" cap-="triangle ribbon" size-={isDesktop ? "half" : undefined}>Top Holders</span>
            {!isDesktop && (
              <span is-="badge" variant-="green" cap-="round" size-="half">
                $SHELBY airdrop eligible
              </span>
            )}
          </row>
          <column gap-="0" style={{ fontSize: isDesktop ? '0.75rem' : '0.9rem', overflow: 'hidden' }}>
            {data.leaderboard.slice(0, maxEntries).map((entry, i) => (
            <column key={`leaderboard-${i}-${entry.address}`} gap-="0">
              <row
                style={{
                  padding: isDesktop ? '0.3rem 0.5rem' : '0.5rem 0.75rem',
                  gap: '0.5rem',
                  alignItems: 'center',
                  maxWidth: '100%',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: 'var(--foreground2)', minWidth: '1.2rem', flexShrink: 0 }}>
                  {i + 1}.
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: isDesktop ? '0.7rem' : '0.85rem',
                    flexShrink: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {shortenAddress(entry.address)}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <AsciiBar width={entry.barWidth} />
                </span>
                <span
                  style={{
                    color: 'var(--accent)',
                    fontWeight: 600,
                    textAlign: 'right',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatAmount(entry.balance)}
                </span>
              </row>
              {i < maxEntries - 1 && (
                <div style={{
                  height: '1px',
                  background: 'var(--background2)',
                  margin: '0 0.75rem',
                }} />
              )}
            </column>
          ))}
        </column>
      </column>

        {/* Most Active Users */}
        <column box-="round" shear-="top" pad-={isDesktop ? "0.5" : "1"} gap-={isDesktop ? "0.5" : "1"}>
          <row gap-="1" style={{ marginBottom: isDesktop ? '0.25rem' : '0.5rem' }}>
            <span is-="badge" variant-="blue" cap-="slant-bottom triangle" size-={isDesktop ? "half" : undefined}>Most Active</span>
            {!isDesktop && <span is-="badge" variant-="background2" cap-="round" size-="half">by tx count</span>}
          </row>
          <column gap-="0" style={{ fontSize: isDesktop ? '0.75rem' : '0.9rem', overflow: 'hidden' }}>
          {data.mostActive.slice(0, maxEntries).map((entry, i) => (
            <column key={`active-${i}-${entry.address}`} gap-="0">
              <row
                style={{
                  padding: isDesktop ? '0.3rem 0.5rem' : '0.5rem 0.75rem',
                  gap: '0.5rem',
                  alignItems: 'center',
                  maxWidth: '100%',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: 'var(--foreground2)', minWidth: '1.2rem', flexShrink: 0 }}>
                  {i + 1}.
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: isDesktop ? '0.7rem' : '0.85rem',
                    flexShrink: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {shortenAddress(entry.address)}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <AsciiBar width={entry.barWidth} />
                </span>
                <span
                  style={{
                    color: '#4A90E2',
                    fontWeight: 600,
                    textAlign: 'right',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.txCount} txs
                </span>
              </row>
              {i < maxEntries - 1 && (
                <div style={{
                  height: '1px',
                  background: 'var(--background2)',
                  margin: '0 0.75rem',
                }} />
              )}
            </column>
          ))}
        </column>
      </column>
      </row>

      {/* Second row: Top Spenders & Recent Transactions */}
      <row style={{ display: isDesktop ? 'grid' : 'flex', gridTemplateColumns: isDesktop ? '1fr 1fr' : '1fr', gap: isDesktop ? '0.5rem' : '2rem', flexDirection: 'column' }}>
        {/* Top Spenders */}
        <column box-="double round" shear-="top" pad-={isDesktop ? "0.5" : "1"} gap-={isDesktop ? "0.5" : "1"}>
          <row gap-="1" style={{ marginBottom: isDesktop ? '0.25rem' : '0.5rem' }}>
            <span is-="badge" variant-="yellow" cap-="ribbon slant-top" size-={isDesktop ? "half" : undefined}>💸 Biggest Spenders</span>
            {!isDesktop && <span is-="badge" variant-="background2" cap-="round" size-="half">total withdrawn</span>}
          </row>
          <column gap-="0" style={{ fontSize: isDesktop ? '0.75rem' : '0.9rem', overflow: 'hidden' }}>
          {data.topSpenders.slice(0, maxEntries).map((entry, i) => (
            <column key={`spender-${i}-${entry.address}`} gap-="0">
              <row
                style={{
                  padding: isDesktop ? '0.3rem 0.5rem' : '0.5rem 0.75rem',
                  gap: '0.5rem',
                  alignItems: 'center',
                  maxWidth: '100%',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: 'var(--foreground2)', minWidth: '1.2rem', flexShrink: 0 }}>
                  {i + 1}.
                </span>
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: isDesktop ? '0.7rem' : '0.85rem',
                    flexShrink: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  {shortenAddress(entry.address)}
                </span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                  <AsciiBar width={entry.barWidth} />
                </span>
                <span
                  style={{
                    color: '#FFA500',
                    fontWeight: 600,
                    textAlign: 'right',
                    flexShrink: 0,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {formatAmount(entry.totalSpent)}
                </span>
              </row>
              {i < maxEntries - 1 && (
                <div style={{
                  height: '1px',
                  background: 'var(--background2)',
                  margin: '0 0.75rem',
                }} />
              )}
            </column>
          ))}
        </column>
      </column>

        {/* Recent Transactions */}
        <column box-="round" shear-="both" pad-={isDesktop ? "0.5" : "1"} gap-={isDesktop ? "0.5" : "1"}>
          <row gap-="1" align-="between" style={{ marginBottom: isDesktop ? '0.25rem' : '0.5rem' }}>
            <span is-="badge" variant-="green" cap-="triangle triangle" size-={isDesktop ? "half" : undefined}>Recent Activity</span>
            {!isDesktop && <span is-="badge" variant-="background2" cap-="round" size-="half">live feed</span>}
          </row>
          <column gap-="0" style={{ fontSize: isDesktop ? '0.7rem' : '0.85rem', fontFamily: 'monospace', overflow: 'hidden' }}>
            {data.recentTransactions.slice(0, maxEntries).map((tx, i) => {
            const txInfo = getTransactionLabel(tx.type);
            return (
              <column key={`tx-${i}-${tx.version}`} gap-="0">
                <row
                  style={{
                    padding: isDesktop ? '0.25rem 0.5rem' : '0.4rem 0.75rem',
                    gap: '0.5rem',
                    alignItems: 'center',
                    maxWidth: '100%',
                    overflow: 'hidden',
                  }}
                >
                  <span
                    style={{
                      color: txInfo.color,
                      fontSize: '0.75rem',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {txInfo.icon} {txInfo.label}
                  </span>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      flexShrink: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {shortenAddress(tx.address)}
                  </span>
                  <span
                    style={{
                      color: 'var(--foreground)',
                      fontWeight: 500,
                      textAlign: 'right',
                      fontSize: '0.75rem',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {formatAmount(tx.amount)}
                  </span>
                  <span
                    style={{
                      color: 'var(--foreground2)',
                      fontSize: '0.7rem',
                      textAlign: 'right',
                      flexShrink: 0,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    #{tx.version}
                  </span>
                </row>
                {i < maxEntries - 1 && (
                  <div style={{
                    height: '1px',
                    background: 'var(--background2)',
                    margin: '0 0.75rem',
                  }} />
                )}
              </column>
            );
          })}
        </column>
      </column>
      </row>

      {/* Shimmer animation for skeleton loading */}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </column>
  );
}

export const EconomyTab = memo(EconomyTabComponent);
