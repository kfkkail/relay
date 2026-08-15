"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    setMessage(error ? error.message : "Check your inbox for a secure sign-in link.");
  }

  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <div className="brand-lockup"><span className="brand-mark">R</span><span>Relay</span></div>
        <p className="eyebrow">Tasks that move</p>
        <h1>Keep the task.<br />Relay the work.</h1>
        <p className="lede">
          Capture clear instructions from your phone, let your laptop do the work,
          and keep the result attached to the task that started it.
        </p>
      </section>
      <section className="auth-card">
        <div className="auth-icon"><Mail size={22} /></div>
        <h2>Sign in to your Relay</h2>
        <p>We’ll email you a one-time link. No password to remember.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Email address</label>
          <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          <button className="primary-button" disabled={busy}>
            {busy ? "Sending…" : "Send sign-in link"}<ArrowRight size={18} />
          </button>
        </form>
        {message && <p className="form-message" role="status">{message}</p>}
        <p className="privacy-note">Your tasks live in your private database, not this public repository.</p>
      </section>
    </main>
  );
}
