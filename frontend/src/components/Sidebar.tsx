import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { clearToken, getHealth } from '../api';

export default function Sidebar() {
  const navigate = useNavigate();
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    const check = () => getHealth().then(setHealth).catch(() => setHealth(null));
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const pipelineOk = health?.status === 'ok';
  const pending = health?.pipeline?.processed_total ?? '—';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-logo">🍄</span>
        <span className="sidebar-title">Mycelium</span>
      </div>

      <nav className="sidebar-nav">
        <NavLink to="/" end className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span>Dashboard</span>
        </NavLink>
        <NavLink to="/queue" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span>Queue</span>
        </NavLink>
        <NavLink to="/approved" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span>Approved</span>
        </NavLink>
        <NavLink to="/search" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span>Search</span>
        </NavLink>
        <NavLink to="/health" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span>Health</span>
        </NavLink>
        <NavLink to="/dead-letters" className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}>
          <span>Dead Letters</span>
        </NavLink>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span className={`status-dot ${pipelineOk ? 'green' : 'red'}`} />
          <span>{pipelineOk ? 'Pipeline OK' : 'Pipeline Down'}</span>
        </div>
        <button className="sidebar-logout" onClick={() => { clearToken(); navigate('/login'); }}>
          Logout
        </button>
      </div>
    </aside>
  );
}
