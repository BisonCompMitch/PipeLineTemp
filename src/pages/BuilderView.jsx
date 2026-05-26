import React from 'react';

const BUILDER_APP_URL = import.meta.env.VITE_BISON_BUILDER_URL || '/builder-app/';

export default function BuilderView() {
  return (
    <section className="builder-page">
      <div className="builder-frame-shell">
        <iframe className="builder-frame" src={BUILDER_APP_URL} title="BisonBuilder" />
      </div>
    </section>
  );
}
