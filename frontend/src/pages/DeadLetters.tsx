import React, { useEffect, useState, useCallback } from 'react';
import { fetchWithAuth, retryDeadLetter } from '../api';
import { SkeletonCard } from '../components/Skeleton';
import { useToast } from '../components/Toast';

interface DeadLetter {
  id: number;
  captureId: string;
  error: string;
  attempts: number;
  payload: string;
  createdAt: string;
}

export default function DeadLetters() {
  const [items, setItems] = useState<DeadLetter[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const { addToast } = useToast();

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetchWithAuth('/api/dead-letters');
      const data = await res.json();
      setItems(data.items || []);
      setCount(data.count || 0);
    } catch {
      setError('Failed to load dead letters.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRetry = async (id: number) => {
    try {
      await retryDeadLetter(String(id));
      setItems(prev => prev.filter(i => i.id !== id));
      setCount(prev => prev - 1);
      addToast('success', 'Dead letter requeued', 'The capture has been sent back to the pipeline for reprocessing.');
    } catch {
      addToast('error', 'Retry failed', 'Could not requeue the dead letter. Try again.');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetchWithAuth(`/api/dead-letters/${id}`, { method: 'DELETE' });
      setItems(prev => prev.filter(i => i.id !== id));
      setCount(prev => prev - 1);
      addToast('success', 'Dead letter dismissed');
    } catch {
      addToast('error', 'Failed to dismiss dead letter');
    }
  };

  if (loading) {
    return (
      <div className="page">
        <h2>Dead Letters</h2>
        <p className="page-subtitle">Loading...</p>
        <SkeletonCard count={3} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h2>Dead Letters</h2>
        <div className="error-state"><p>{error}</p><button className="btn-retry" onClick={load}>Retry</button></div>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Dead Letters ({count})</h2>
      <p className="page-subtitle">Captures that failed extraction after all retries</p>

      {items.length === 0 ? (
        <div className="empty-state"><p>No dead letters. All captures processed successfully.</p></div>
      ) : (
        <div className="engram-list">
          {items.map(item => (
            <div key={item.id} className={`engram-card ${expanded === item.id ? 'expanded' : ''}`} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
              <div className="engram-header">
                <div className="engram-info">
                  <h3 className="engram-title">{item.captureId}</h3>
                  <div className="engram-meta">
                    <span className="engram-source source-desktop">Failed</span>
                    <span className="engram-separator">&bull;</span>
                    <span>{item.attempts} attempt{item.attempts !== 1 ? 's' : ''}</span>
                    <span className="engram-separator">&bull;</span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <div className="engram-actions" onClick={e => e.stopPropagation()}>
                  <button className="btn-approve" onClick={() => handleRetry(item.id)}>Retry</button>
                  <button className="btn-dismiss" onClick={() => handleDelete(item.id)}>Dismiss</button>
                </div>
              </div>
              {expanded === item.id && (
                <div className="engram-details">
                  <div className="detail-section">
                    <label>Error</label>
                    <pre className="raw-text">{item.error}</pre>
                  </div>
                  <div className="detail-section">
                    <label>Payload</label>
                    <pre className="raw-text">{(() => { try { return JSON.stringify(JSON.parse(item.payload), null, 2); } catch { return item.payload; } })()}</pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
