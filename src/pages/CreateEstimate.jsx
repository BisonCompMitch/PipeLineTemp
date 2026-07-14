import React, { useState } from 'react';

const DEFAULT_ESTIMATE_URL = 'https://bisoncompmitch.github.io/Estima/';

function normalizeEstimateUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_ESTIMATE_URL;
  try {
    const url = new URL(raw, window.location.origin);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/+$/, '/');
  } catch (_error) {
    return DEFAULT_ESTIMATE_URL;
  }
}

export default function CreateEstimate() {
  const [loaded, setLoaded] = useState(false);
  const estimateUrl = normalizeEstimateUrl(import.meta.env.VITE_ESTIMATE_APP_URL || DEFAULT_ESTIMATE_URL);

  return (
    <section className="create-estimate-page">
      <div className="create-estimate-shell">
        <div className="create-estimate-frame-wrap">
          {!loaded ? <div className="create-estimate-loading">Loading estimator…</div> : null}
          <iframe
            className="create-estimate-frame"
            src={estimateUrl}
            title="Create Estimate"
            onLoad={() => setLoaded(true)}
            loading="eager"
          />
        </div>
      </div>
    </section>
  );
}
