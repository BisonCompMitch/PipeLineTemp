import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'bisonworks:file-view-mode';
const EVENT_NAME = 'bisonworks:file-view-mode-change';
const VALID_MODES = ['card', 'list'];

function readStoredMode() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return VALID_MODES.includes(stored) ? stored : 'card';
  } catch (_err) {
    return 'card';
  }
}

export default function useFileViewMode() {
  const [viewMode, setViewMode] = useState(readStoredMode);

  useEffect(() => {
    const handleChange = (event) => {
      const nextMode = event?.detail?.mode;
      if (VALID_MODES.includes(nextMode)) {
        setViewMode(nextMode);
      }
    };
    window.addEventListener(EVENT_NAME, handleChange);
    return () => window.removeEventListener(EVENT_NAME, handleChange);
  }, []);

  const changeViewMode = useCallback((nextMode) => {
    if (!VALID_MODES.includes(nextMode)) return;
    setViewMode(nextMode);
    try {
      window.localStorage.setItem(STORAGE_KEY, nextMode);
    } catch (_err) {
      // ignore storage errors (e.g. private browsing)
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { mode: nextMode } }));
  }, []);

  return [viewMode, changeViewMode];
}
