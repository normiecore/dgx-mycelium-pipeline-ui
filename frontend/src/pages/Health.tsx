import React, { useEffect, useState } from 'react';
import { getHealth } from '../api';
import StatusBadge from '../components/StatusBadge';

export default function Health() {
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const load = () => getHealth().then(setHealth).catch(() => setHealth(null));
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, []);

  if (!health) return <div className="page-loading">Loading health data...</div>;

  const metrics = health.metrics || {};
  const checks = health.checks || {};

  return (
    <div className="page">
      <h2>Pipeline Health</h2>
      <p className="page-subtitle">Auto-refreshes every 10 seconds</p>

      <div className="health-section">
        <h3>Services</h3>
        <div className="health-grid">
          {Object.entries(checks).map(([name, ok]) => (
            <StatusBadge
              key={name}
              label={name}
              status={ok ? 'healthy' : 'unreachable'}
            />
          ))}
          {Object.keys(checks).length === 0 && (
            <span className="text-muted">No service checks configured</span>
          )}
        </div>
      </div>

      <div className="health-section">
        <h3>Pipeline Metrics</h3>
        {health.metrics ? (
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-value">{metrics.processed_total ?? 0}</span>
              <span className="metric-label">Processed</span>
            </div>
            <div className="metric">
              <span className="metric-value">{metrics.blocked_total ?? 0}</span>
              <span className="metric-label">Blocked</span>
            </div>
            <div className="metric">
              <span className="metric-value">{metrics.deduplicated_total ?? 0}</span>
              <span className="metric-label">Deduplicated</span>
            </div>
            <div className="metric">
              <span className="metric-value">{metrics.errors_total ?? 0}</span>
              <span className="metric-label">Errors</span>
            </div>
          </div>
        ) : (
          <span className="text-muted">No metrics available</span>
        )}
      </div>

      <div className="health-section">
        <h3>System</h3>
        <div className="system-info">
          <div>
            <span className="info-label">Status:</span>{' '}
            <span className={health.status === 'ok' ? 'text-ok' : 'text-error'}>
              {health.status}
            </span>
          </div>
          <div>
            <span className="info-label">Timestamp:</span>{' '}
            {health.timestamp ? new Date(health.timestamp).toLocaleString() : '—'}
          </div>
          <div>
            <span className="info-label">Last Poll:</span>{' '}
            {metrics.last_poll_at
              ? new Date(metrics.last_poll_at).toLocaleString()
              : 'Never'}
          </div>
        </div>
      </div>
    </div>
  );
}
