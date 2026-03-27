import React, { useEffect, useState, useCallback } from 'react';
import { getEngrams, connectWebSocket } from '../api';
import EngramCard from '../components/EngramCard';

export default function Approved() {
  const [engrams, setEngrams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEngrams = useCallback(async () => {
    try {
      setError(null);
      const data = await getEngrams('approved');
      setEngrams(data.engrams || []);
    } catch (err) {
      console.error('Failed to load approved engrams:', err);
      setError('Failed to load approved engrams. Check your connection and try again.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadEngrams();
    const ws = connectWebSocket((data) => {
      if (data.type === 'engram_updated' && data.status === 'approved') {
        loadEngrams();
      }
    });
    return () => ws.close();
  }, [loadEngrams]);

  if (loading) {
    return (
      <div className="page">
        <h2>Approved Knowledge</h2>
        <div className="page-loading">
          <div className="spinner" />
          <p>Loading approved engrams...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <h2>Approved Knowledge</h2>
        <div className="error-state">
          <p>{error}</p>
          <button className="btn-retry" onClick={loadEngrams}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <h2>Approved Knowledge</h2>
      <p className="page-subtitle">{engrams.length} approved engram{engrams.length !== 1 ? 's' : ''}</p>
      {engrams.length === 0 ? (
        <div className="empty-state"><p>No approved engrams yet.</p></div>
      ) : (
        <div className="engram-list">
          {engrams.map(e => (
            <EngramCard key={e.id} engram={e} showActions={false} />
          ))}
        </div>
      )}
    </div>
  );
}
