import React from 'react';

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M2 12C3.9 8.4 7.6 6 12 6C16.4 6 20.1 8.4 22 12C20.1 15.6 16.4 18 12 18C7.6 18 3.9 15.6 2 12Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.6 6.2C11.1 6.1 11.5 6 12 6C16.4 6 20.1 8.4 22 12C21.2 13.6 20.1 14.9 18.7 15.9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M14.6 14.7C13.9 15.3 13 15.7 12 15.7C9.9 15.7 8.2 14 8.2 12C8.2 11 8.6 10.1 9.2 9.4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 8.2C4.6 9.2 3.1 10.5 2 12C3.9 15.6 7.6 18 12 18C13.9 18 15.7 17.6 17.2 16.8"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 3L21 21" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function PasswordToggleButton({ shown = false, onClick, disabled = false }) {
  const label = shown ? 'Hide password' : 'Show password';
  return (
    <button
      type="button"
      className="ghost password-toggle-btn"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}
