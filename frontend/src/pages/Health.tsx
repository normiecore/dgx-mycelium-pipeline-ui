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

  const pipeline = health.pipeline || {};

  return (
    <div className="page">
      <h2>Pipeline Health</h2>
      <p className="page-subtitle">Auto-refreshes every 10 seconds</p>

      <div className="health-section">
        <h3>Services</h3>
        <div className="health-grid">
          {health.services && Object.entries(health.services).map(([name, status]) => (
            <StatusBadge key={name} label={name} status={status as string} />
          ))}
        </div>
      </div>

      <div className="health-section">
        <h3>Pipeline Metrics</h3>
        <div className="metrics-grid">
          <div className="metric">
            <span className="metric-value">{pipeline.processed_total ?? 0}</span>
            <span className="metric-label">Processed</span>
          </div>
          <div className="metric">
            <span className="metric-value">{pipeline.blocked_total ?? 0}</span>
            <span className="metric-label">Blocked</span>
          </div>
          <div className="metric">
            <span className="metric-value">{pipeline.deduplicated_total ?? 0}</span>
            <span className="metric-label">Deduplicated</span>
          </div>
          <div className="metric">
            <span className="metric-value">{pipeline.errors_total ?? 0}</span>
            <span className="metric-label">Errors</span>
          </div>
        </div>
      </div>

      <div className="health-section">
        <h3>System</h3>
        <div className="system-info">
          <div><span className="info-label">Uptime:</span> {health.uptime_seconds ? `${Math.floor(health.uptime_seconds / 60)}m ${health.uptime_seconds % 60}s` : '—'}</div>
          <div><span className="info-label">Last Poll:</span> {pipeline.last_poll_at || 'Never'}</div>
          <div><span className="info-label">Status:</span> <span className={health.status === 'ok' ? 'text-ok' : 'text-error'}>{health.status}</span></div>
        </div>
      </div>
    </div>
  );
}
