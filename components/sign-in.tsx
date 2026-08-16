"use client";

import { useState } from "react";
import { ArrowRight, LogIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function SignIn({ privateMessage = false }: { privateMessage?: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function signInWithGitHub() {
    setBusy(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });

    if (!error) return;

    setBusy(false);
    setMessage(error.message);
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
        <div className="auth-icon"><LogIn size={22} /></div>
        <h2>Sign in to your Relay</h2>
        <p>Use your GitHub account to securely access your tasks.</p>
        {privateMessage && <p className="form-message" role="alert">This is a private Relay deployment. That GitHub account is not authorized.</p>}
        <button className="primary-button" type="button" disabled={busy} onClick={signInWithGitHub}>
          <LogIn size={18} />{busy ? "Redirecting…" : "Continue with GitHub"}<ArrowRight size={18} />
        </button>
        {message && <p className="form-message" role="alert">{message}</p>}
        <p className="privacy-note">Your tasks live in your private database, not this public repository.</p>
      </section>
    </main>
  );
}
