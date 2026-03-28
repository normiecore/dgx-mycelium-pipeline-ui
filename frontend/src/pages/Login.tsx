import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../api';

export default function Login() {
  const [token, setTokenValue] = useState('');
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      setToken(token.trim());
      navigate('/queue');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>🍄 Mycelium</h1>
        <p className="login-subtitle">Organisational knowledge, connected.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="login-token" className="sr-only">JWT Token</label>
          <textarea
            id="login-token"
            className="token-input"
            placeholder="Paste your JWT token here..."
            value={token}
            onChange={e => setTokenValue(e.target.value)}
            rows={4}
            aria-label="JWT Token"
          />
          <button type="submit" className="btn-login">Sign In</button>
        </form>
      </div>
    </div>
  );
}
