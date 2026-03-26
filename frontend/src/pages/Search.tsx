import React, { useState } from 'react';
import { getEngrams } from '../api';
import EngramCard from '../components/EngramCard';

export default function Search() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await getEngrams(undefined, query);
      setResults(data.engrams || []);
    } catch (err) {
      console.error('Search failed:', err);
    }
    setSearched(true);
    setLoading(false);
  };

  return (
    <div className="page">
      <h2>Search Knowledge</h2>
      <form onSubmit={handleSearch} className="search-form">
        <input
          type="text"
          className="search-input"
          placeholder="Search engrams... (e.g. 'pipe stress analysis')"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button type="submit" className="btn-search" disabled={loading}>
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>
      {searched && (
        results.length === 0 ? (
          <div className="empty-state"><p>No results found for "{query}"</p></div>
        ) : (
          <div className="engram-list">
            {results.map((e, i) => (
              <EngramCard key={e.id || i} engram={e} showActions={false} />
            ))}
          </div>
        )
      )}
    </div>
  );
}
