import React, { useMemo, useState } from 'react';
import logo from '../assets/BisonWorksFavicon.png';
import { completeFirstLogin } from '../api.js';

export default function FirstLoginSetup({ initialUsername = '', email = '', onComplete, onSignOut }) {
  const suggestedUsername = useMemo(() => {
    const fromInitial = String(initialUsername || '').trim();
    if (fromInitial) return fromInitial;
    return String(email || '').trim();
  }, [email, initialUsername]);
  const [username, setUsername] = useState(suggestedUsername);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const normalizedUsername = String(username || '').trim();
    if (!normalizedUsername) {
      setError('Username is required.');
      return;
    }
    if (/\s/.test(normalizedUsername)) {
      setError('Username cannot contain spaces.');
      return;
    }
    if (!password) {
      setError('New password is required.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await completeFirstLogin({
        login_username: normalizedUsername,
        new_password: password
      });
      onComplete?.(result);
    } catch (err) {
      setError(err.message || 'Unable to complete setup.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="login">
      <div className="login-card first-login-card">
        <div className="login-brand">
          <img src={logo} alt="BisonWorks" className="login-logo" />
          <div>
            <h2>Complete Setup</h2>
            <p className="muted">Set your username and a new password to continue.</p>
          </div>
        </div>
        {error ? <div className="alert">{error}</div> : null}
        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Username
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Username"
              autoComplete="username"
              disabled={saving}
            />
          </label>
          <label>
            New password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password"
              autoComplete="new-password"
              disabled={saving}
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Confirm password"
              autoComplete="new-password"
              disabled={saving}
            />
          </label>
          <p className="muted first-login-hint">Password must be at least 8 characters.</p>
          <div className="actions first-login-actions">
            <button className="ghost" type="button" onClick={onSignOut} disabled={saving}>
              Sign out
            </button>
            <button className="primary login-button" type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save and continue'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
