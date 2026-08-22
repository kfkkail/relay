import Link from "next/link";

export default function NotFound() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <p className="eyebrow">Not found</p>
        <h1>This Relay item is unavailable.</h1>
        <p>It may have been deleted, or you may not have access to it.</p>
        <Link className="primary-button" href="/tasks">
          Back to tasks
        </Link>
      </section>
    </main>
  );
}
