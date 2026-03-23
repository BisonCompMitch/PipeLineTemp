import React, { useState } from 'react';
import logo from '../assets/BisonWorksFavicon.png';
import { loginRequest } from '../api.js';
import useSiteDialog from '../utils/useSiteDialog.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { alertDialog, dialogPortal } = useSiteDialog();

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Enter a username and password.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await loginRequest(username.trim(), password);
      if (!response.ok) {
        const message =
          response.status === 401
            ? 'Invalid username or password.'
            : `Sign in failed (${response.status}).`;
        throw new Error(message);
      }
      const payload = await response.json();
      const canonicalUsername = String(payload?.username || payload?.login_username || username.trim()).trim();
      onLogin?.(canonicalUsername, payload);
    } catch (err) {
      setError(err.message || 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (!error) return;
    let active = true;
    (async () => {
      await alertDialog(error, { title: 'Sign in error', confirmText: 'OK' });
      if (active) setError('');
    })();
    return () => {
      active = false;
    };
  }, [error, alertDialog]);

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <img src={logo} alt="BisonWorks" className="login-logo" />
          <div>
            <h2>BisonWorks</h2>
            <p className="muted">Please sign in.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
            />
          </label>
          <label>
            Password
            <div className="login-password-row">
              <input
                className="login-password-input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M1.5 12S5.5 5.5 12 5.5 22.5 12 22.5 12 18.5 18.5 12 18.5 1.5 12 1.5 12Z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
                </svg>
              </button>
            </div>
          </label>
          <button className="primary login-button" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
      {dialogPortal}
    </div>
  );
}
