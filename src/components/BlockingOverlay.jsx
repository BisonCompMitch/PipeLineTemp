import React from 'react';
import ModalPortal from './ModalPortal.jsx';

export default function BlockingOverlay({ open = false, title = 'Working...', message = '' }) {
  if (!open) return null;

  return (
    <ModalPortal>
      <div className="modal-backdrop preview-backdrop blocking-overlay-backdrop">
        <div className="modal blocking-overlay-modal" role="status" aria-live="polite">
          <div className="file-preview-loading">
            <div className="file-preview-spinner" aria-hidden="true" />
            <p className="blocking-overlay-title">{title}</p>
            {message ? <p className="blocking-overlay-message">{message}</p> : null}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
