"use client";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="launch-splash launch-splash--error">
      <div className="launch-splash__content">
        <div className="launch-splash__mark" aria-hidden="true">
          R
        </div>
        <h1>Relay couldn’t load</h1>
        <p>Something interrupted startup. Try loading Relay again.</p>
        <button type="button" onClick={reset}>
          Retry
        </button>
      </div>
    </main>
  );
}
