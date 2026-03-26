import React, { useEffect, useState } from 'react';
import { getEngrams } from '../api';
import EngramCard from '../components/EngramCard';

export default function Approved() {
  const [engrams, setEngrams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getEngrams('approved')
      .then(data => setEngrams(data.engrams || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page-loading">Loading...</div>;

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
