export function SetupPanel() {
  return (
    <main className="setup-shell">
      <section className="setup-card">
        <div className="brand-mark" aria-hidden="true">
          R
        </div>
        <p className="eyebrow">Relay setup</p>
        <h1>Connect the private data layer.</h1>
        <p>
          The app scaffold is ready. Add the three Supabase values from{" "}
          <code>.env.example</code>, run the included migration, and restart the
          app.
        </p>
        <div className="setup-steps">
          <span>1</span>
          <p>Create a Supabase project.</p>
          <span>2</span>
          <p>Run the initial SQL migration.</p>
          <span>3</span>
          <p>Configure local or Vercel environment values.</p>
        </div>
        <p className="privacy-note">
          No sample tasks, credentials, or personal paths are bundled.
        </p>
      </section>
    </main>
  );
}
