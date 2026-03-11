import React, { useCallback, useEffect, useRef, useState } from 'react';
import ModalPortal from '../components/ModalPortal.jsx';

function buildDialog(type, message, options = {}) {
  return {
    type,
    title: String(options.title || '').trim() || 'Please confirm',
    message: String(message || '').trim(),
    confirmText: String(options.confirmText || '').trim() || (type === 'alert' ? 'OK' : 'Confirm'),
    cancelText: String(options.cancelText || '').trim() || 'Cancel'
  };
}

export default function useSiteDialog() {
  const resolverRef = useRef(null);
  const [dialog, setDialog] = useState(null);
  const [promptValue, setPromptValue] = useState('');

  const closeWithResult = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    setPromptValue('');
    if (resolve) resolve(result);
  }, []);

  const openDialog = useCallback((nextDialog, initialValue = '') => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPromptValue(initialValue);
      setDialog(nextDialog);
    });
  }, []);

  const confirmDialog = useCallback(
    (message, options = {}) => openDialog(buildDialog('confirm', message, options), ''),
    [openDialog]
  );

  const promptDialog = useCallback(
    (message, options = {}) =>
      openDialog(
        buildDialog('prompt', message, {
          ...options,
          confirmText: options.confirmText || 'Save'
        }),
        String(options.defaultValue || '')
      ),
    [openDialog]
  );

  const alertDialog = useCallback(
    (message, options = {}) => openDialog(buildDialog('alert', message, options), ''),
    [openDialog]
  );

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(null);
        resolverRef.current = null;
      }
    };
  }, []);

  const dialogPortal = dialog ? (
    <ModalPortal>
      <div
        className="modal-backdrop preview-backdrop"
        onClick={() => {
          if (dialog.type === 'alert') {
            closeWithResult(undefined);
            return;
          }
          closeWithResult(dialog.type === 'confirm' ? false : null);
        }}
      >
        <div className="modal site-dialog-modal" onClick={(event) => event.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title">{dialog.title}</div>
          </div>
          <div className="site-dialog-body">
            <p className="site-dialog-message">{dialog.message}</p>
            {dialog.type === 'prompt' ? (
              <input
                className="site-dialog-input"
                value={promptValue}
                autoFocus
                onChange={(event) => setPromptValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    closeWithResult(promptValue);
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    closeWithResult(null);
                  }
                }}
              />
            ) : null}
            <div className="actions">
              {dialog.type !== 'alert' ? (
                <button
                  className="ghost"
                  type="button"
                  onClick={() => closeWithResult(dialog.type === 'confirm' ? false : null)}
                >
                  {dialog.cancelText}
                </button>
              ) : null}
              <button
                className="primary"
                type="button"
                onClick={() => {
                  if (dialog.type === 'confirm') {
                    closeWithResult(true);
                    return;
                  }
                  if (dialog.type === 'prompt') {
                    closeWithResult(promptValue);
                    return;
                  }
                  closeWithResult(undefined);
                }}
                autoFocus={dialog.type !== 'prompt'}
              >
                {dialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  ) : null;

  return {
    confirmDialog,
    promptDialog,
    alertDialog,
    dialogPortal
  };
}
