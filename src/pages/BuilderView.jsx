import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { getAccessToken } from '../utils/authStorage.js';

function defaultBuilderAppUrl() {
  return '/builder-app/';
}

const BUILDER_APP_URL = import.meta.env.VITE_BISON_BUILDER_URL || defaultBuilderAppUrl();
const BUILDER_ASSIGNMENT_EVENT = 'bisonworks-builder-assignment-updated';
const BUILDER_ASSIGNMENT_STORAGE_KEY = 'bisonworks_builder_assignment_updated';

function resolveOrigin(url) {
  try {
    return new URL(url, window.location.href).origin;
  } catch (_error) {
    return window.location.origin;
  }
}

function readLatestBuilderAssignment() {
  try {
    const raw = window.localStorage.getItem(BUILDER_ASSIGNMENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

export default function BuilderView({ capabilities = null, theme = 'dark' }) {
  const frameRef = useRef(null);
  const builderOrigin = useMemo(() => resolveOrigin(BUILDER_APP_URL), []);
  const builderTheme = String(theme || '').trim().toLowerCase() === 'light' ? 'light' : 'dark';
  const builderCapabilities = useMemo(() => {
    const source = capabilities && typeof capabilities === 'object' ? capabilities : {};
    const canAssign = !!source.canAssign;
    return {
      assignedOnly: !!source.assignedOnly,
      canUpload: !!source.canUpload,
      canAssign,
      canClearAssignment: source.canClearAssignment === undefined ? canAssign : !!source.canClearAssignment,
      canUseProjectSelector: !!source.canUseProjectSelector || canAssign
    };
  }, [capabilities]);

  const sendAuthToBuilder = useCallback(() => {
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) return;
    const latestAssignment = readLatestBuilderAssignment();
    targetWindow.postMessage(
      {
        type: 'bisonworks-builder-auth',
        accessToken: getAccessToken(),
        canUpload: builderCapabilities.canUpload,
        projectId: latestAssignment?.projectId || '',
        theme: builderTheme,
        capabilities: builderCapabilities
      },
      builderOrigin
    );
  }, [builderOrigin, builderCapabilities, builderTheme]);

  const sendAssignmentUpdateToBuilder = useCallback((payload = {}) => {
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) return;
    targetWindow.postMessage(
      {
        type: BUILDER_ASSIGNMENT_EVENT,
        projectId: payload.projectId || '',
        builderFileId: payload.builderFileId || null,
        hasBuilderModel: Boolean(payload.hasBuilderModel)
      },
      builderOrigin
    );
  }, [builderOrigin]);

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== builderOrigin) return;
      if (event.data?.type === 'bisonbuilder-ready') {
        sendAuthToBuilder();
      }
    };
    const handleAssignmentEvent = (event) => {
      sendAssignmentUpdateToBuilder(event.detail || {});
    };
    const handleStorage = (event) => {
      if (event.key !== BUILDER_ASSIGNMENT_STORAGE_KEY || !event.newValue) return;
      try {
        sendAssignmentUpdateToBuilder(JSON.parse(event.newValue));
      } catch (_error) {
        // Ignore malformed storage events from older tabs.
      }
    };

    const initialTimer = window.setTimeout(sendAuthToBuilder, 500);
    const refreshTimer = window.setInterval(sendAuthToBuilder, 30000);
    window.addEventListener('message', handleMessage);
    window.addEventListener(BUILDER_ASSIGNMENT_EVENT, handleAssignmentEvent);
    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', sendAuthToBuilder);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener(BUILDER_ASSIGNMENT_EVENT, handleAssignmentEvent);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', sendAuthToBuilder);
    };
  }, [builderOrigin, sendAssignmentUpdateToBuilder, sendAuthToBuilder]);

  return (
    <section className="builder-page">
      <div className="builder-frame-shell">
        <iframe
          ref={frameRef}
          className="builder-frame"
          src={BUILDER_APP_URL}
          title="BisonBuilder"
          onLoad={sendAuthToBuilder}
        />
      </div>
    </section>
  );
}
