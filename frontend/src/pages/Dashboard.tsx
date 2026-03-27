import React, { useEffect, useState } from 'react';
import {
  getAnalyticsOverview,
  getAnalyticsVolume,
  getAnalyticsSources,
  getAnalyticsTopTags,
  getAnalyticsConfidence,
} from '../api';

interface OverviewData {
  totalEngrams: number;
  byStatus: { pending: number; approved: number; dismissed: number };
  captures: { today: number; week: number; month: number };
  avgConfidence: number;
  pipeline: {
    processed_total: number;
    blocked_total: number;
    deduplicated_total: number;
    errors_total: number;
  };
}

interface VolumeEntry {
  date: string;
  count: number;
  approved: number;
  dismissed: number;
  pending: number;
}

interface SourceEntry {
  source: string;
  count: number;
  percentage: number;
}

interface TagEntry {
  tag: string;
  count: number;
}

interface ConfidenceEntry {
  range: string;
  count: number;
}

export default function Dashboard() {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [volume, setVolume] = useState<VolumeEntry[]>([]);
  const [sources, setSources] = useState<SourceEntry[]>([]);
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [confidence, setConfidence] = useState<ConfidenceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([
      getAnalyticsOverview(),
      getAnalyticsVolume('day'),
      getAnalyticsSources(),
      getAnalyticsTopTags(20),
      getAnalyticsConfidence(),
    ])
      .then(([ov, vol, src, tg, conf]) => {
        setOverview(ov);
        setVolume(vol.volume);
        setSources(src.sources);
        setTags(tg.tags);
        setConfidence(conf.distribution);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="page page-loading">
        <div className="spinner" />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={load}>Retry</button>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const errorRate =
    overview.pipeline.processed_total > 0
      ? Math.round(
          (overview.pipeline.errors_total / overview.pipeline.processed_total) * 1000,
        ) / 10
      : 0;

  const volumeMax = Math.max(...volume.map((v) => v.count), 1);
  const sourceMax = Math.max(...sources.map((s) => s.count), 1);
  const confMax = Math.max(...confidence.map((c) => c.count), 1);
  const tagMax = Math.max(...tags.map((t) => t.count), 1);

  return (
    <div className="page dash-page">
      <h2>Dashboard</h2>
      <p className="page-subtitle">Knowledge pipeline overview</p>

      {/* Stats cards */}
      <div className="dash-stats">
        <div className="dash-stat-card">
          <span className="dash-stat-icon">&#x1F4E6;</span>
          <div className="dash-stat-body">
            <span className="dash-stat-value">{overview.totalEngrams}</span>
            <span className="dash-stat-label">Total Engrams</span>
          </div>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-icon">&#x1F4C5;</span>
          <div className="dash-stat-body">
            <span className="dash-stat-value">{overview.captures.today}</span>
            <span className="dash-stat-label">Today's Captures</span>
          </div>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-icon">&#x1F3AF;</span>
          <div className="dash-stat-body">
            <span className="dash-stat-value">
              {(overview.avgConfidence * 100).toFixed(1)}%
            </span>
            <span className="dash-stat-label">Avg Confidence</span>
          </div>
        </div>
        <div className="dash-stat-card">
          <span className="dash-stat-icon">&#x26A0;</span>
          <div className="dash-stat-body">
            <span className="dash-stat-value">{errorRate}%</span>
            <span className="dash-stat-label">Error Rate</span>
          </div>
        </div>
      </div>

      {/* Pipeline counters */}
      <div className="dash-pipeline-row">
        <span className="dash-pipeline-chip">
          Processed: <strong>{overview.pipeline.processed_total}</strong>
        </span>
        <span className="dash-pipeline-chip">
          Blocked: <strong>{overview.pipeline.blocked_total}</strong>
        </span>
        <span className="dash-pipeline-chip">
          Deduplicated: <strong>{overview.pipeline.deduplicated_total}</strong>
        </span>
        <span className="dash-pipeline-chip">
          Errors: <strong>{overview.pipeline.errors_total}</strong>
        </span>
      </div>

      <div className="dash-grid">
        {/* Volume chart */}
        <div className="dash-card">
          <h3 className="dash-card-title">Capture Volume (14 days)</h3>
          {volume.length === 0 ? (
            <div className="empty-state">No capture data yet</div>
          ) : (
            <div className="dash-bar-chart">
              {volume.map((v) => (
                <div className="dash-bar-col" key={v.date}>
                  <div className="dash-bar-stack" title={`${v.count} captures`}>
                    <div
                      className="dash-bar dash-bar-approved"
                      style={{ height: `${(v.approved / volumeMax) * 100}%` }}
                    />
                    <div
                      className="dash-bar dash-bar-pending"
                      style={{ height: `${(v.pending / volumeMax) * 100}%` }}
                    />
                    <div
                      className="dash-bar dash-bar-dismissed"
                      style={{ height: `${(v.dismissed / volumeMax) * 100}%` }}
                    />
                  </div>
                  <span className="dash-bar-label">
                    {v.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="dash-legend">
            <span className="dash-legend-item">
              <span className="dash-legend-dot" style={{ background: 'var(--success)' }} /> Approved
            </span>
            <span className="dash-legend-item">
              <span className="dash-legend-dot" style={{ background: 'var(--accent)' }} /> Pending
            </span>
            <span className="dash-legend-item">
              <span className="dash-legend-dot" style={{ background: 'var(--danger)' }} /> Dismissed
            </span>
          </div>
        </div>

        {/* Source breakdown */}
        <div className="dash-card">
          <h3 className="dash-card-title">Sources</h3>
          {sources.length === 0 ? (
            <div className="empty-state">No source data yet</div>
          ) : (
            <div className="dash-h-bars">
              {sources.map((s) => (
                <div className="dash-h-bar-row" key={s.source}>
                  <span className="dash-h-bar-label">{s.source}</span>
                  <div className="dash-h-bar-track">
                    <div
                      className="dash-h-bar-fill"
                      style={{ width: `${(s.count / sourceMax) * 100}%` }}
                    />
                  </div>
                  <span className="dash-h-bar-value">
                    {s.count} ({s.percentage}%)
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top tags */}
        <div className="dash-card">
          <h3 className="dash-card-title">Top Tags</h3>
          {tags.length === 0 ? (
            <div className="empty-state">No tags yet</div>
          ) : (
            <div className="dash-tag-cloud">
              {tags.map((t) => {
                const scale = 0.7 + (t.count / tagMax) * 0.6;
                return (
                  <span
                    className="dash-tag-chip"
                    key={t.tag}
                    style={{ fontSize: `${scale}em` }}
                    title={`${t.count} occurrences`}
                  >
                    {t.tag}
                    <span className="dash-tag-count">{t.count}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>

        {/* Confidence histogram */}
        <div className="dash-card">
          <h3 className="dash-card-title">Confidence Distribution</h3>
          {confidence.every((c) => c.count === 0) ? (
            <div className="empty-state">No confidence data yet</div>
          ) : (
            <div className="dash-histogram">
              {confidence.map((c) => (
                <div className="dash-hist-col" key={c.range}>
                  <span className="dash-hist-count">{c.count}</span>
                  <div
                    className="dash-hist-bar"
                    style={{ height: `${(c.count / confMax) * 100}%` }}
                  />
                  <span className="dash-hist-label">{c.range}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
