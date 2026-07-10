import React from 'react';

export default function FileViewToggle({ viewMode, onChange }) {
  return (
    <div className="file-view-toggle" role="group" aria-label="File display mode">
      <button
        type="button"
        className={`file-view-toggle-option${viewMode === 'card' ? ' active' : ''}`}
        aria-pressed={viewMode === 'card'}
        onClick={() => onChange('card')}
      >
        Card view
      </button>
      <button
        type="button"
        className={`file-view-toggle-option${viewMode === 'list' ? ' active' : ''}`}
        aria-pressed={viewMode === 'list'}
        onClick={() => onChange('list')}
      >
        List view
      </button>
    </div>
  );
}
