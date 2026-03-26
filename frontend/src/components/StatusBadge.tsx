import React from 'react';

interface StatusBadgeProps {
  status: string;
  label: string;
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const isOk = status === 'connected' || status === 'healthy' || status === 'ok';
  return (
    <div className="status-badge">
      <span className={`status-dot ${isOk ? 'green' : 'red'}`} />
      <span className="status-label">{label}</span>
      <span className={`status-value ${isOk ? 'ok' : 'error'}`}>{status}</span>
    </div>
  );
}
