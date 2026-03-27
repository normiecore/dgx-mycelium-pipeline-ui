import React from 'react';

interface SkeletonTextProps {
  width?: 'short' | 'medium' | 'long' | 'full';
  count?: number;
}

export function SkeletonText({ width = 'full', count = 1 }: SkeletonTextProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`skeleton skeleton-text ${width !== 'full' ? width : ''}`}
          style={width === 'full' ? { width: '100%' } : undefined}
        />
      ))}
    </>
  );
}

interface SkeletonCardProps {
  count?: number;
}

export function SkeletonCard({ count = 3 }: SkeletonCardProps) {
  return (
    <div className="engram-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeleton-card" />
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  cols?: number;
}

export function SkeletonTable({ rows = 4, cols = 3 }: SkeletonTableProps) {
  return (
    <div className="skeleton-table">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-table-row">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton skeleton-table-cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface SkeletonMetricGridProps {
  count?: number;
}

export function SkeletonMetricGrid({ count = 4 }: SkeletonMetricGridProps) {
  return (
    <div className="skeleton-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton skeleton-metric" />
      ))}
    </div>
  );
}
