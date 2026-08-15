import { useState, useEffect } from 'react';

interface Activity {
  id: string;
  type: 'upload' | 'download' | 'audit' | 'payment';
  description: string;
  time: string;
  status: 'success' | 'pending' | 'failed';
}

export function LiveFeedCompact() {
  const [activities, setActivities] = useState<Activity[]>([]);

  useEffect(() => {
    const generateActivity = (): Activity => {
      const types: Activity['type'][] = ['upload', 'upload', 'download', 'audit', 'payment'];
      const type = types[Math.floor(Math.random() * types.length)];

      const descriptions = {
        upload: [
          'New blob registered (2.4 MB)',
          'Image uploaded (156 KB)',
          'Video chunk stored (8.1 MB)',
          'Document saved (45 KB)'
        ],
        download: [
          'Blob retrieved (1.2 MB)',
          'File downloaded (890 KB)',
          'Asset accessed (234 KB)'
        ],
        audit: [
          'Audit challenge issued to SP #12',
          'Audit response verified for SP #7',
          'Scrub tree validated across 4 SPs'
        ],
        payment: [
          'Read micropayment: $0.00012',
          'Storage reward distributed',
          'Tier 1 fee processed'
        ]
      };

      const status: Activity['status'] = Math.random() > 0.15 ? 'success' : Math.random() > 0.5 ? 'pending' : 'failed';

      return {
        id: Math.random().toString(36),
        type,
        description: descriptions[type][Math.floor(Math.random() * descriptions[type].length)],
        time: new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        status
      };
    };

    // Initial activities
    setActivities([generateActivity(), generateActivity(), generateActivity()]);

    const interval = setInterval(() => {
      const newActivity = generateActivity();
      setActivities(prev => [newActivity, ...prev].slice(0, 5));
    }, 3000 + Math.random() * 2000);

    return () => clearInterval(interval);
  }, []);

  const getTypeIcon = (type: Activity['type']) => {
    switch (type) {
      case 'upload': return '▲';
      case 'download': return '▼';
      case 'audit': return '🔍';
      case 'payment': return '💰';
    }
  };

  const getTypeBadge = (type: Activity['type']) => {
    switch (type) {
      case 'upload': return 'green';
      case 'download': return 'blue';
      case 'audit': return 'pink';
      case 'payment': return 'orange';
    }
  };

  const getStatusBadge = (status: Activity['status']) => {
    switch (status) {
      case 'success': return 'green';
      case 'pending': return 'blue';
      case 'failed': return 'red';
    }
  };

  return (
    <column box-="round" pad-="2">
      <row align-="center between" style={{ marginBottom: '1lh' }}>
        <column>
          <span style={{ fontSize: '1.2em', fontWeight: 'bold', color: 'var(--pink)', letterSpacing: '0.05em' }}>
            ▸ LIVE NETWORK ACTIVITY
          </span>
          <span style={{ fontSize: '0.95em', color: 'var(--foreground2)', marginTop: '0.3lh' }}>
            Real-time protocol events
          </span>
        </column>
        <span is-="badge" variant-="pink" style={{ fontSize: '1em', padding: '0.3em 0.8em' }}>⟳ LIVE</span>
      </row>

      <div is-="separator">━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</div>

      {activities.length === 0 ? (
        <column align-="center center" style={{ padding: '3lh 0' }}>
          <div is-="spinner" variant-="dots"></div>
        </column>
      ) : (
        <column gap-="0" style={{ marginTop: '1lh' }}>
          {activities.map((activity, i) => (
            <column key={activity.id}>
              <row gap-="2" align-="center between" style={{ padding: '1lh 0' }}>
                <row gap-="2" align-="center start" style={{ flex: 1 }}>
                  <span style={{ fontSize: '1.3em' }}>{getTypeIcon(activity.type)}</span>
                  <column gap-="0.3" style={{ flex: 1 }}>
                    <span style={{ fontSize: '1em' }}>{activity.description}</span>
                    <span style={{ fontSize: '0.85em', color: 'var(--foreground2)', fontFamily: 'monospace' }}>{activity.time}</span>
                  </column>
                </row>
                <span
                  is-="badge"
                  variant-={getStatusBadge(activity.status)}
                  style={{ fontSize: '0.85em', padding: '0.2em 0.6em' }}
                >
                  {activity.status === 'success' ? '✓' : activity.status === 'pending' ? '...' : '✗'}
                </span>
              </row>
              {i < activities.length - 1 && (
                <div is-="separator">- - - - - - - - - - - - - - - - - - - - - - -</div>
              )}
            </column>
          ))}
        </column>
      )}
    </column>
  );
}
