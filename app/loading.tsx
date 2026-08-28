export default function Loading() {
  return (
    <main className="launch-splash" aria-busy="true">
      <div className="launch-splash__content" role="status" aria-live="polite">
        <div className="launch-splash__mark" aria-hidden="true">
          R
        </div>
        <div className="launch-splash__indicator" aria-hidden="true" />
        <p>Loading your Relay…</p>
      </div>
    </main>
  );
}
