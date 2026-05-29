import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { getAccessToken } from '../utils/authStorage.js';

function defaultBuilderAppUrl() {
  return '/builder-app/';
}

const BUILDER_APP_URL = import.meta.env.VITE_BISON_BUILDER_URL || defaultBuilderAppUrl();

function resolveOrigin(url) {
  try {
    return new URL(url, window.location.href).origin;
  } catch (_error) {
    return window.location.origin;
  }
}

export default function BuilderView({ canUpload = false }) {
  const frameRef = useRef(null);
  const builderOrigin = useMemo(() => resolveOrigin(BUILDER_APP_URL), []);

  const sendAuthToBuilder = useCallback(() => {
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) return;
    targetWindow.postMessage(
      {
        type: 'bisonworks-builder-auth',
        accessToken: getAccessToken(),
        canUpload
      },
      builderOrigin
    );
  }, [builderOrigin, canUpload]);

  useEffect(() => {
    const handleMessage = (event) => {
      if (event.origin !== builderOrigin) return;
      if (event.data?.type === 'bisonbuilder-ready') {
        sendAuthToBuilder();
      }
    };

    const initialTimer = window.setTimeout(sendAuthToBuilder, 500);
    const refreshTimer = window.setInterval(sendAuthToBuilder, 30000);
    window.addEventListener('message', handleMessage);
    window.addEventListener('focus', sendAuthToBuilder);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('focus', sendAuthToBuilder);
    };
  }, [builderOrigin, sendAuthToBuilder]);

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
